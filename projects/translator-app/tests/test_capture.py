"""Tests for the WASAPI loopback capture stream (TASK-1103).

The real PyAudioWPatch stream is replaced by a fake stream/backend so the
threading, queueing, format, and start/stop lifecycle are exercised
deterministically with nothing installed.

    python -m unittest discover -s tests
"""

import os
import sys
import threading
import time
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from translator_app.audio.devices import AudioDevice  # noqa: E402


def _device(channels=2, rate=48000.0):
    return AudioDevice(
        id="abc123",
        index=3,
        name="Speakers [Loopback]",
        host_api="0",
        max_input_channels=channels,
        default_sample_rate=rate,
        is_loopback=True,
    )


class FakeStream:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self._i = 0
        self.closed = False
        self.exhausted = threading.Event()

    def read(self, frames):
        if self._i < len(self._chunks):
            chunk = self._chunks[self._i]
            self._i += 1
            return chunk
        self.exhausted.set()
        time.sleep(0.005)
        return b""

    def close(self):
        self.closed = True


class FakeBackend:
    def __init__(self, stream):
        self.stream = stream
        self.opened_with = None

    def open_stream(self, device, fmt, frames_per_buffer):
        self.opened_with = (device, fmt, frames_per_buffer)
        return self.stream


class FormatTest(unittest.TestCase):
    def test_default_format_derives_from_device(self):
        from translator_app.audio.capture import LoopbackCapture

        cap = LoopbackCapture(_device(channels=2, rate=44100.0), FakeBackend(FakeStream([])))
        self.assertEqual(cap.format.sample_rate, 44100)
        self.assertEqual(cap.format.channels, 2)
        # Documented capture format: 16-bit signed PCM.
        self.assertEqual(cap.format.dtype, "int16")
        self.assertEqual(cap.format.sample_width, 2)


class CaptureLifecycleTest(unittest.TestCase):
    def test_captures_frames_into_queue(self):
        from translator_app.audio.capture import LoopbackCapture

        chunks = [b"aa", b"bb", b"cc"]
        stream = FakeStream(chunks)
        cap = LoopbackCapture(_device(), FakeBackend(stream), frames_per_buffer=2)

        cap.start()
        self.assertTrue(stream.exhausted.wait(timeout=2.0), "capture never consumed the stream")

        collected = []
        while len(collected) < len(chunks):
            collected.append(cap.read_frame(timeout=1.0))
        cap.stop()

        self.assertEqual(collected, chunks)

    def test_open_stream_receives_device_and_format(self):
        from translator_app.audio.capture import LoopbackCapture

        device = _device()
        backend = FakeBackend(FakeStream([]))
        cap = LoopbackCapture(device, backend, frames_per_buffer=512)
        cap.start()
        cap.stop()

        opened_device, opened_fmt, fpb = backend.opened_with
        self.assertIs(opened_device, device)
        self.assertEqual(opened_fmt, cap.format)
        self.assertEqual(fpb, 512)

    def test_start_then_stop_is_clean(self):
        from translator_app.audio.capture import LoopbackCapture

        stream = FakeStream([b"x"])
        cap = LoopbackCapture(_device(), FakeBackend(stream))

        cap.start()
        self.assertTrue(cap.is_running())
        cap.stop()

        self.assertFalse(cap.is_running())
        self.assertTrue(stream.closed, "stream must be closed on stop")

    def test_double_start_raises(self):
        from translator_app.audio.capture import LoopbackCapture

        cap = LoopbackCapture(_device(), FakeBackend(FakeStream([])))
        cap.start()
        try:
            with self.assertRaises(RuntimeError):
                cap.start()
        finally:
            cap.stop()

    def test_stop_is_idempotent(self):
        from translator_app.audio.capture import LoopbackCapture

        cap = LoopbackCapture(_device(), FakeBackend(FakeStream([])))
        cap.start()
        cap.stop()
        cap.stop()  # must not raise
        self.assertFalse(cap.is_running())


if __name__ == "__main__":
    unittest.main()
