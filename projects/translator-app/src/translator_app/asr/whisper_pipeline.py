"""Real-time Japanese ASR pipeline (TASK-1104).

:class:`WhisperPipeline` turns the raw PCM frames produced by the loopback
capture stream (TASK-1103) into Japanese transcript segments, emitting *partial*
results quickly and *finalized* segments as more audio settles.

Streaming strategy
------------------
A sliding window is kept in a byte buffer. Every ``step_seconds`` of newly
captured audio, the whole window is re-transcribed by an injectable
:class:`Transcriber`. Of the returned segments:

* Those that end before ``buffer_duration - commit_tail_seconds`` are considered
  **settled** -- emitted as final segments and trimmed from the buffer so they
  are never reprocessed (this is what keeps latency bounded).
* The trailing, still-changing text is emitted as a single **partial** segment
  that downstream (translation / subtitles) can keep replacing in place.

If the buffer ever exceeds ``window_seconds`` without anything settling, the
whole window is force-finalized and cleared so latency can't run away.

This module imports with nothing installed: numpy is only touched by
:func:`default_converter`, and faster-whisper only by
:class:`FasterWhisperTranscriber`, both lazily.

Audio contract
--------------
Frames arrive as little-endian int16 PCM at ``input_rate`` / ``input_channels``
(the capture device's native format). The converter downmixes to mono and
resamples to ``target_rate`` float32 -- faster-whisper expects 16 kHz mono
float32, so ``target_rate`` should stay 16000.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, List, Optional, Protocol, Sequence, Tuple, Union

RawSegment = Union["_HasSegmentFields", Tuple[float, float, str]]


@dataclass(frozen=True)
class Segment:
    """A transcript segment with stream-absolute timing (seconds)."""

    text: str
    start: float
    end: float
    is_final: bool


class _HasSegmentFields(Protocol):
    start: float
    end: float
    text: str


class Transcriber(Protocol):
    """Runs speech-to-text over a block of model-ready audio."""

    def transcribe(self, audio: object, sample_rate: int) -> Iterable[RawSegment]: ...


def _norm(seg: RawSegment) -> Tuple[float, float, str]:
    if isinstance(seg, tuple):
        start, end, text = seg
        return float(start), float(end), str(text)
    return float(seg.start), float(seg.end), str(seg.text)


def default_converter(
    *, input_rate: int, input_channels: int, target_rate: int = 16000
) -> Callable[[bytes], object]:
    """Build the production PCM->float converter (lazily imports numpy).

    Returns a callable that turns int16 PCM bytes into a contiguous mono
    float32 numpy array at ``target_rate`` (linear resampling).
    """

    def convert(pcm_bytes: bytes):
        import numpy as np  # noqa: PLC0415 (lazy: heavy native dep)

        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if input_channels > 1:
            audio = audio.reshape(-1, input_channels).mean(axis=1)
        if input_rate != target_rate and audio.size:
            duration = audio.size / input_rate
            target_n = int(round(duration * target_rate))
            if target_n > 0:
                x_old = np.linspace(0.0, duration, num=audio.size, endpoint=False)
                x_new = np.linspace(0.0, duration, num=target_n, endpoint=False)
                audio = np.interp(x_new, x_old, audio)
        return np.ascontiguousarray(audio, dtype=np.float32)

    return convert


class WhisperPipeline:
    """Stream PCM frames in, get partial then finalized transcript segments out."""

    def __init__(
        self,
        transcriber: Transcriber,
        *,
        input_rate: int,
        input_channels: int,
        target_rate: int = 16000,
        step_seconds: float = 1.0,
        window_seconds: float = 12.0,
        commit_tail_seconds: float = 2.0,
        converter: Optional[Callable[[bytes], object]] = None,
        on_segment: Optional[Callable[[Segment], None]] = None,
    ) -> None:
        self._transcriber = transcriber
        self._input_rate = input_rate
        self._frame_bytes = input_channels * 2  # int16
        self._target_rate = target_rate
        self._step_bytes = max(self._frame_bytes, int(round(step_seconds * input_rate)) * self._frame_bytes)
        self._window_seconds = window_seconds
        self._commit_tail_seconds = commit_tail_seconds
        self._convert = converter or default_converter(
            input_rate=input_rate, input_channels=input_channels, target_rate=target_rate
        )
        self._on_segment = on_segment

        self._buffer = bytearray()
        self._bytes_since_run = 0
        self._offset = 0.0  # seconds of audio already finalized + trimmed

    @property
    def committed_seconds(self) -> float:
        """Audio (seconds) finalized and trimmed out of the live buffer."""
        return self._offset

    @property
    def buffered_seconds(self) -> float:
        """Audio (seconds) currently held in the sliding window."""
        return (len(self._buffer) // self._frame_bytes) / self._input_rate

    def feed(self, pcm: bytes) -> List[Segment]:
        """Add captured PCM; transcribe + emit when enough has accumulated."""
        if pcm:
            self._buffer.extend(pcm)
            self._bytes_since_run += len(pcm)
        if not self._buffer:
            return []
        over_window = self.buffered_seconds > self._window_seconds
        if self._bytes_since_run < self._step_bytes and not over_window:
            return []
        return self._emit(self._run(force=over_window))

    def flush(self) -> List[Segment]:
        """End of stream: transcribe whatever's left and finalize all of it."""
        if not self._buffer:
            return []
        base = self._offset
        raw = self._transcribe()
        out = [Segment(t.strip(), base + s, base + e, True) for s, e, t in raw if t.strip()]
        self._offset += self.buffered_seconds
        self._buffer.clear()
        self._bytes_since_run = 0
        return self._emit(out)

    # -- internals -----------------------------------------------------------

    def _transcribe(self) -> List[Tuple[float, float, str]]:
        audio = self._convert(bytes(self._buffer))
        raw = [_norm(r) for r in self._transcriber.transcribe(audio, self._target_rate)]
        raw.sort(key=lambda s: s[0])
        return raw

    def _run(self, *, force: bool) -> List[Segment]:
        self._bytes_since_run = 0
        base = self._offset
        buf_dur = self.buffered_seconds  # buffer length at run time (pre-trim)
        raw = self._transcribe()
        if not raw:
            return []

        if force:
            out = [Segment(t.strip(), base + s, base + e, True) for s, e, t in raw if t.strip()]
            self._offset += buf_dur
            self._buffer.clear()
            return out

        boundary = buf_dur - self._commit_tail_seconds
        settled_count = 0
        for _start, end, _text in raw:
            if end <= boundary:
                settled_count += 1
            else:
                break
        settled = raw[:settled_count]
        trailing = raw[settled_count:]

        out: List[Segment] = [
            Segment(t.strip(), base + s, base + e, True) for s, e, t in settled if t.strip()
        ]
        if settled:
            self._trim(settled[-1][1])

        partial_text = "".join(t for _s, _e, t in trailing).strip()
        if partial_text:
            out.append(Segment(partial_text, base + trailing[0][0], base + buf_dur, False))
        return out

    def _trim(self, seconds: float) -> None:
        trim_bytes = int(round(seconds * self._input_rate)) * self._frame_bytes
        trim_bytes = min(trim_bytes, len(self._buffer))
        trim_bytes -= trim_bytes % self._frame_bytes
        del self._buffer[:trim_bytes]
        self._offset += (trim_bytes // self._frame_bytes) / self._input_rate

    def _emit(self, segments: List[Segment]) -> List[Segment]:
        if self._on_segment:
            for seg in segments:
                self._on_segment(seg)
        return segments


class FasterWhisperTranscriber:
    """Production transcriber backed by faster-whisper on the GPU.

    Lazy-imports faster-whisper so this module loads without it. ``model_size``
    is the latency/accuracy lever wired up by TASK-1110 (e.g. ``"small"`` for
    speed, ``"large-v3"`` for accuracy).
    """

    def __init__(
        self,
        model_size: str = "small",
        *,
        device: str = "cuda",
        compute_type: str = "float16",
        language: str = "ja",
        beam_size: int = 1,
    ) -> None:
        from faster_whisper import WhisperModel  # noqa: PLC0415 (lazy: heavy GPU dep)

        self._model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self._language = language
        self._beam_size = beam_size

    def transcribe(self, audio: object, sample_rate: int) -> Sequence[Tuple[float, float, str]]:
        segments, _info = self._model.transcribe(
            audio,
            language=self._language,
            task="transcribe",
            beam_size=self._beam_size,
        )
        return [(s.start, s.end, s.text) for s in segments]
