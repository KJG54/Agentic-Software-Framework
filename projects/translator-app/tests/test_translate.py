"""Tests for Japanese->English translation (TASK-1105).

faster-whisper's WhisperModel is replaced by a fake that records the kwargs it
was called with, so the language-pair interface and the JA->EN implementation
are tested with nothing installed. One test also feeds the translator through
the streaming WhisperPipeline (TASK-1104) to prove the integration seam.

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


class FakeSeg:
    def __init__(self, start, end, text):
        self.start = start
        self.end = end
        self.text = text


class FakeModel:
    """Stands in for faster_whisper.WhisperModel."""

    def __init__(self, segments):
        self._segments = list(segments)
        self.calls = []

    def transcribe(self, audio, language=None, task=None, beam_size=None):
        self.calls.append(
            {"audio": audio, "language": language, "task": task, "beam_size": beam_size}
        )
        return iter(list(self._segments)), object()


class LanguagePairTest(unittest.TestCase):
    def test_parse_accepts_arrow_and_dash(self):
        from translator_app.translate.interface import LanguagePair

        self.assertEqual(LanguagePair.parse("ja->en"), LanguagePair("ja", "en"))
        self.assertEqual(LanguagePair.parse("JA-EN"), LanguagePair("ja", "en"))
        self.assertEqual(LanguagePair.parse("ja_en"), LanguagePair("ja", "en"))

    def test_parse_rejects_garbage(self):
        from translator_app.translate.interface import LanguagePair

        with self.assertRaises(ValueError):
            LanguagePair.parse("japanese")

    def test_is_hashable_and_stringifies(self):
        from translator_app.translate.interface import LanguagePair

        pair = LanguagePair("ja", "en")
        self.assertEqual(str(pair), "ja->en")
        self.assertIn(pair, {pair: 1})


class FactoryTest(unittest.TestCase):
    def test_create_returns_translator_for_supported_pair(self):
        from translator_app.translate.interface import LanguagePair, create_translator

        translator = create_translator(LanguagePair("ja", "en"), model=FakeModel([]))
        self.assertEqual(translator.pair, LanguagePair("ja", "en"))

    def test_unsupported_pair_raises(self):
        from translator_app.translate.interface import (
            LanguagePair,
            UnsupportedLanguagePairError,
            create_translator,
        )

        with self.assertRaises(UnsupportedLanguagePairError):
            create_translator(LanguagePair("ja", "ko"))

    def test_supported_pairs_includes_ja_en(self):
        from translator_app.translate.interface import LanguagePair, supported_pairs

        self.assertIn(LanguagePair("ja", "en"), supported_pairs())


class WhisperJaEnTest(unittest.TestCase):
    def test_translates_via_translate_task(self):
        from translator_app.translate.whisper_ja_en import WhisperJaEnTranslator

        model = FakeModel([FakeSeg(0.0, 1.5, " Hello"), FakeSeg(1.5, 3.0, " world")])
        translator = WhisperJaEnTranslator(model=model)

        out = list(translator.transcribe(b"audio", 16000))

        self.assertEqual(out, [(0.0, 1.5, " Hello"), (1.5, 3.0, " world")])
        call = model.calls[0]
        self.assertEqual(call["task"], "translate", "must use Whisper's translate task")
        self.assertEqual(call["language"], "ja")

    def test_streams_english_through_the_pipeline(self):
        from translator_app.asr.whisper_pipeline import WhisperPipeline
        from translator_app.translate.whisper_ja_en import WhisperJaEnTranslator

        model = FakeModel([FakeSeg(0.0, 1.5, " Hello"), FakeSeg(1.5, 3.0, " world")])
        translator = WhisperJaEnTranslator(model=model)
        pipe = WhisperPipeline(
            translator,
            input_rate=16000,
            input_channels=1,
            converter=lambda pcm: pcm,
            step_seconds=1.0,
            window_seconds=30.0,
            commit_tail_seconds=2.0,
        )

        out = pipe.feed(b"\x00\x00" * 48000)  # 3s @ 16k mono
        partials = [s for s in out if not s.is_final]

        self.assertEqual(len(partials), 1)
        self.assertEqual(partials[0].text, "Hello world")


if __name__ == "__main__":
    unittest.main()
