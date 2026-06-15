"""Tests for latency-accuracy wiring and ephemeral settings (TASK-1110).

Two concerns, both pure (no faster-whisper, no GUI):

* Ephemeral settings -- every launch starts from the documented defaults and
  nothing carries over from a previous run.
* Latency/accuracy wiring -- changing the model size (or language pair)
  rebuilds the ASR transcriber + pipeline and hands the new pipeline to the
  running worker.

    python -m unittest discover -s tests
"""

import os
import queue
import sys
import time
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


def wait_until(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


class EphemeralSettingsTest(unittest.TestCase):
    def test_defaults_are_the_documented_values(self):
        from translator_app.settings import default_settings
        from translator_app.translate.interface import LanguagePair
        from translator_app.ui.settings_bar import ModelSize
        from translator_app.ui.subtitle_renderer import SubtitlePosition

        s = default_settings()
        self.assertEqual(s.language_pair, LanguagePair("ja", "en"))
        self.assertEqual(s.font_size_pt, 32)
        self.assertEqual(s.position, SubtitlePosition.BOTTOM)
        self.assertEqual(s.background_opacity, 0.5)
        self.assertEqual(s.model_size, ModelSize.SMALL)

    def test_each_launch_starts_from_pristine_defaults(self):
        from translator_app.settings import default_settings
        from translator_app.ui.settings_bar import ModelSize

        # Simulate a previous run mutating its settings...
        previous = default_settings()
        previous.font_size_pt = 99
        previous.model_size = ModelSize.LARGE

        # ...a new launch must not inherit any of that.
        fresh = default_settings()
        self.assertEqual(fresh.font_size_pt, 32)
        self.assertEqual(fresh.model_size, ModelSize.SMALL)
        self.assertIsNot(fresh, previous)

    def test_no_persistence_layer(self):
        # Ephemeral by construction: there is no load/save API to read prior state.
        import translator_app.settings as settings

        self.assertFalse(hasattr(settings, "load_settings"))
        self.assertFalse(hasattr(settings, "save_settings"))


class RecordingBuilder:
    def __init__(self):
        self.calls = []

    def __call__(self, model_size, language_pair):
        self.calls.append((model_size, language_pair))
        return ("transcriber", model_size, language_pair)


class PipelineReconfiguratorTest(unittest.TestCase):
    def _wire(self):
        from translator_app.settings import PipelineReconfigurator
        from translator_app.ui.settings_bar import SettingsController

        controller = SettingsController()
        builder = RecordingBuilder()
        sink = []
        reconfig = PipelineReconfigurator(
            controller,
            build_transcriber=builder,
            make_pipeline=lambda t: ("pipeline", t),
            on_pipeline=sink.append,
        )
        return controller, builder, sink, reconfig

    def test_changing_model_size_rebuilds_transcriber_and_pipeline(self):
        from translator_app.translate.interface import LanguagePair
        from translator_app.ui.settings_bar import ModelSize

        controller, builder, sink, _r = self._wire()
        controller.set_model_size(ModelSize.MEDIUM)

        self.assertEqual(builder.calls, [(ModelSize.MEDIUM, LanguagePair("ja", "en"))])
        self.assertEqual(sink[-1], ("pipeline", ("transcriber", ModelSize.MEDIUM, LanguagePair("ja", "en"))))

    def test_changing_language_pair_also_rebuilds(self):
        from translator_app.translate.interface import LanguagePair

        controller, builder, sink, _r = self._wire()
        controller.set_language_pair(LanguagePair("ja", "en"))
        self.assertEqual(len(builder.calls), 1)
        self.assertEqual(len(sink), 1)

    def test_unrelated_changes_do_not_rebuild(self):
        controller, builder, sink, _r = self._wire()
        controller.set_font_size(50)
        controller.set_opacity(0.9)
        self.assertEqual(builder.calls, [])
        self.assertEqual(sink, [])

    def test_initial_rebuild_uses_current_defaults(self):
        from translator_app.translate.interface import LanguagePair
        from translator_app.ui.settings_bar import ModelSize

        _controller, builder, sink, reconfig = self._wire()
        pipeline = reconfig.rebuild()
        self.assertEqual(builder.calls, [(ModelSize.SMALL, LanguagePair("ja", "en"))])
        self.assertEqual(sink[-1], pipeline)


class BuildDefaultTranscriberTest(unittest.TestCase):
    def test_passes_model_size_string_and_pair_to_create_translator(self):
        from translator_app.settings import build_default_transcriber
        from translator_app.translate.interface import LanguagePair
        from translator_app.ui.settings_bar import ModelSize

        calls = []

        def fake_create(pair, **options):
            calls.append((pair, options))
            return "backend"

        out = build_default_transcriber(
            ModelSize.MEDIUM, LanguagePair("ja", "en"), create=fake_create
        )
        self.assertEqual(out, "backend")
        self.assertEqual(calls, [(LanguagePair("ja", "en"), {"model_size": "medium"})])


class DefaultPipelineFactoryTest(unittest.TestCase):
    def test_factory_builds_a_pipeline_bound_to_the_capture_format(self):
        from translator_app.asr.whisper_pipeline import WhisperPipeline
        from translator_app.settings import default_pipeline_factory

        make = default_pipeline_factory(
            input_rate=48000, input_channels=2, converter=lambda pcm: pcm
        )
        pipeline = make(object())  # a stand-in transcriber
        self.assertIsInstance(pipeline, WhisperPipeline)


class AsrWorkerSetPipelineTest(unittest.TestCase):
    def test_set_pipeline_swaps_the_active_pipeline_while_running(self):
        from translator_app.app import AsrWorker

        class FakePipeline:
            def __init__(self):
                self.fed = []

            def feed(self, chunk):
                self.fed.append(chunk)
                return []

        a, b = FakePipeline(), FakePipeline()
        frames = queue.Queue()
        worker = AsrWorker(frames, a, poll_timeout=0.02)
        worker.start()
        try:
            worker.set_pipeline(b)  # swap before any frame arrives
            frames.put(b"x")
            self.assertTrue(wait_until(lambda: b.fed == [b"x"]), "new pipeline must receive frames")
            self.assertEqual(a.fed, [], "old pipeline must not receive post-swap frames")
        finally:
            worker.stop()


if __name__ == "__main__":
    unittest.main()
