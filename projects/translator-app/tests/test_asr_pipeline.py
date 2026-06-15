"""Tests for the real-time Japanese ASR pipeline (TASK-1104).

The faster-whisper model is replaced by a scripted fake transcriber and the
numpy PCM->float converter is replaced by an identity callable, so the
chunking / partial-vs-final / buffer-trimming logic is exercised
deterministically with nothing installed.

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

RATE = 16000
FRAME_BYTES = 2  # int16 mono


def pcm(seconds, rate=RATE, channels=1):
    """A block of silent int16 PCM of the given duration."""
    return b"\x00\x00" * int(round(seconds * rate)) * channels


class ScriptedTranscriber:
    """Returns canned segment lists per call; records calls."""

    def __init__(self, responses):
        self._responses = list(responses)
        self._i = 0
        self.calls = []

    def transcribe(self, audio, sample_rate):
        self.calls.append((audio, sample_rate))
        if self._i < len(self._responses):
            resp = self._responses[self._i]
            self._i += 1
            return resp
        return []


def _identity(pcm_bytes):
    return pcm_bytes


def _pipe(transcriber, **kw):
    from translator_app.asr.whisper_pipeline import WhisperPipeline

    kw.setdefault("input_rate", RATE)
    kw.setdefault("input_channels", 1)
    kw.setdefault("converter", _identity)
    return WhisperPipeline(transcriber, **kw)


class TriggerTest(unittest.TestCase):
    def test_no_transcribe_until_step_seconds_buffered(self):
        t = ScriptedTranscriber([[]])
        p = _pipe(t, step_seconds=1.0, window_seconds=30.0, commit_tail_seconds=2.0)

        self.assertEqual(p.feed(pcm(0.5)), [])
        self.assertEqual(len(t.calls), 0, "should not transcribe below the step size")

        out = p.feed(pcm(0.6))  # total 1.1s >= step
        self.assertEqual(out, [])
        self.assertEqual(len(t.calls), 1, "should transcribe once the step is reached")

    def test_empty_feed_is_noop(self):
        t = ScriptedTranscriber([])
        p = _pipe(t)
        self.assertEqual(p.feed(b""), [])
        self.assertEqual(len(t.calls), 0)


class PartialThenFinalTest(unittest.TestCase):
    def test_partial_only_when_nothing_has_settled(self):
        t = ScriptedTranscriber([[(0.0, 1.5, "こんにちは"), (1.5, 3.0, "世界")]])
        p = _pipe(t, step_seconds=1.0, window_seconds=30.0, commit_tail_seconds=2.0)

        out = p.feed(pcm(3.0))

        finals = [s for s in out if s.is_final]
        partials = [s for s in out if not s.is_final]
        self.assertEqual(finals, [], "nothing past the commit tail should finalize yet")
        self.assertEqual(len(partials), 1)
        self.assertEqual(partials[0].text, "こんにちは世界")
        self.assertFalse(partials[0].is_final)
        self.assertAlmostEqual(p.committed_seconds, 0.0)

    def test_settled_segment_finalizes_and_trims(self):
        t = ScriptedTranscriber([
            [(0.0, 1.5, "こんにちは"), (1.5, 3.0, "世界")],
            [(0.0, 1.5, "こんにちは"), (1.5, 3.2, "世界、"), (3.2, 5.0, "お元気ですか")],
        ])
        p = _pipe(t, step_seconds=1.0, window_seconds=30.0, commit_tail_seconds=2.0)

        p.feed(pcm(3.0))           # -> partial only
        out = p.feed(pcm(2.0))     # buffer 5s, boundary = 3.0s

        finals = [s for s in out if s.is_final]
        partials = [s for s in out if not s.is_final]

        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0].text, "こんにちは")
        self.assertAlmostEqual(finals[0].start, 0.0)
        self.assertAlmostEqual(finals[0].end, 1.5)

        self.assertEqual(len(partials), 1)
        self.assertEqual(partials[0].text, "世界、お元気ですか")
        self.assertAlmostEqual(partials[0].start, 1.5)
        self.assertAlmostEqual(partials[0].end, 5.0)

        # Finalized audio is trimmed from the buffer so it is not reprocessed.
        self.assertAlmostEqual(p.committed_seconds, 1.5)


class WindowCapTest(unittest.TestCase):
    def test_window_overflow_force_finalizes_and_clears(self):
        t = ScriptedTranscriber([[(0.0, 1.0, "あ"), (1.0, 3.0, "い")]])
        # commit tail bigger than the buffer would normally block finalization;
        # the window cap must force it anyway.
        p = _pipe(t, step_seconds=1.0, window_seconds=2.0, commit_tail_seconds=5.0)

        out = p.feed(pcm(3.0))  # 3s > 2s window -> force

        self.assertTrue(all(s.is_final for s in out))
        self.assertEqual([s.text for s in out], ["あ", "い"])
        self.assertAlmostEqual(p.committed_seconds, 3.0)
        self.assertEqual(p.buffered_seconds, 0.0, "buffer must be cleared after a forced flush")


class FlushTest(unittest.TestCase):
    def test_flush_finalizes_remaining_buffer(self):
        t = ScriptedTranscriber([
            [(0.0, 1.5, "とちゅう")],          # feed run -> partial (tail blocks finalize)
            [(0.0, 1.5, "おわり")],            # flush run -> finalized
        ])
        p = _pipe(t, step_seconds=1.0, window_seconds=30.0, commit_tail_seconds=2.0)

        p.feed(pcm(1.5))
        out = p.flush()

        self.assertEqual(len(out), 1)
        self.assertTrue(out[0].is_final)
        self.assertEqual(out[0].text, "おわり")
        self.assertEqual(p.buffered_seconds, 0.0)

    def test_flush_empty_buffer_is_noop(self):
        t = ScriptedTranscriber([])
        p = _pipe(t)
        self.assertEqual(p.flush(), [])
        self.assertEqual(len(t.calls), 0)


class CallbackTest(unittest.TestCase):
    def test_on_segment_receives_each_emitted_segment(self):
        seen = []
        t = ScriptedTranscriber([[(0.0, 1.5, "こんにちは"), (1.5, 3.0, "世界")]])
        p = _pipe(t, step_seconds=1.0, window_seconds=30.0, commit_tail_seconds=2.0,
                  on_segment=seen.append)

        out = p.feed(pcm(3.0))
        self.assertEqual(seen, out)


class DefaultConverterTest(unittest.TestCase):
    def test_downmix_resample_to_mono_float32(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy not installed")

        from translator_app.asr.whisper_pipeline import default_converter

        convert = default_converter(input_rate=48000, input_channels=2, target_rate=16000)
        # 0.5s of stereo int16 -> 0.5s mono float32 at 16k.
        frames = np.full((24000, 2), 16384, dtype=np.int16).tobytes()
        out = convert(frames)

        self.assertEqual(out.dtype, np.float32)
        self.assertEqual(out.ndim, 1)
        self.assertEqual(out.size, 8000)  # 0.5s @ 16k
        self.assertTrue(np.all(out > 0.4) and np.all(out < 0.6))


if __name__ == "__main__":
    unittest.main()
