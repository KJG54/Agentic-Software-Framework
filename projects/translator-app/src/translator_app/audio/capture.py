"""WASAPI loopback capture stream (TASK-1103).

:class:`LoopbackCapture` opens an input stream on a chosen loopback device and
pumps raw PCM frames onto a thread-safe queue from a dedicated capture thread,
with a clean start/stop lifecycle. The actual stream is obtained from an
injectable :class:`CaptureBackend`; the real one (PyAudioWPatch) lazy-imports
the dependency so this module imports without it. The ASR consumer (TASK-1104)
drains the queue.

Capture format
--------------
Frames are 16-bit signed little-endian PCM (``dtype="int16"``,
``sample_width=2``) at the device's native sample rate and channel count.
Downmix/resample to whatever the ASR model wants (Whisper: 16 kHz mono float32)
happens downstream, not here.
"""

from __future__ import annotations

import queue
import threading
from dataclasses import dataclass
from typing import Optional, Protocol

from .devices import AudioDevice


@dataclass(frozen=True)
class AudioFormat:
    sample_rate: int
    channels: int
    dtype: str = "int16"
    sample_width: int = 2  # bytes per sample


def _default_format(device: AudioDevice) -> AudioFormat:
    return AudioFormat(
        sample_rate=int(device.default_sample_rate),
        channels=max(1, device.max_input_channels),
    )


class CaptureStream(Protocol):
    def read(self, frames: int) -> bytes: ...
    def close(self) -> None: ...


class CaptureBackend(Protocol):
    def open_stream(self, device: AudioDevice, fmt: AudioFormat, frames_per_buffer: int) -> CaptureStream: ...


class LoopbackCapture:
    """Capture loopback audio from ``device`` into a frame queue."""

    def __init__(
        self,
        device: AudioDevice,
        backend: CaptureBackend,
        *,
        fmt: Optional[AudioFormat] = None,
        frames_per_buffer: int = 1024,
        queue_maxsize: int = 0,
    ) -> None:
        self.device = device
        self.backend = backend
        self.format = fmt or _default_format(device)
        self.frames_per_buffer = frames_per_buffer
        self.frames: "queue.Queue[bytes]" = queue.Queue(maxsize=queue_maxsize)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._stream: Optional[CaptureStream] = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.is_running():
            raise RuntimeError("capture is already running")
        self._stop.clear()
        self._stream = self.backend.open_stream(self.device, self.format, self.frames_per_buffer)
        self._thread = threading.Thread(
            target=self._run, name=f"loopback-capture-{self.device.id}", daemon=True
        )
        self._thread.start()

    def _run(self) -> None:
        stream = self._stream
        assert stream is not None
        try:
            while not self._stop.is_set():
                chunk = stream.read(self.frames_per_buffer)
                if chunk:
                    self.frames.put(chunk)
        finally:
            stream.close()

    def stop(self, timeout: float = 2.0) -> None:
        """Signal the capture thread to stop and wait for it to finish.

        Idempotent: calling stop() when not running is a no-op.
        """
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
            self._thread = None
        self._stream = None

    def read_frame(self, timeout: Optional[float] = None) -> bytes:
        """Block for the next captured frame (raises ``queue.Empty`` on timeout)."""
        return self.frames.get(timeout=timeout)


class PyAudioWPatchCaptureBackend:
    """Real capture backend backed by PyAudioWPatch. Lazy-imports the dependency."""

    def __init__(self) -> None:
        import pyaudiowpatch as pyaudio  # noqa: PLC0415 (lazy: heavy, Windows-only)

        self._pyaudio = pyaudio
        self._pa = pyaudio.PyAudio()

    def open_stream(self, device: AudioDevice, fmt: AudioFormat, frames_per_buffer: int):
        return self._pa.open(
            format=self._pyaudio.paInt16,
            channels=fmt.channels,
            rate=fmt.sample_rate,
            frames_per_buffer=frames_per_buffer,
            input=True,
            input_device_index=device.index,
        )

    def close(self) -> None:
        self._pa.terminate()
