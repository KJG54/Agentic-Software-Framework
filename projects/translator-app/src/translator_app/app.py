"""Application shell and clean shutdown (TASK-1109).

Ties the runtime pieces together and, more importantly for this task, owns a
*clean* teardown. The overlay runs over whatever the user is watching, so when
they exit (settings-bar Exit or the top-right button -- see
:mod:`translator_app.ui.exit_controls`) the audio capture thread and the ASR
worker thread must stop promptly, without leaking threads or hanging.

Pieces
------
* :class:`AsrWorker` -- a daemon thread that drains captured PCM frames off the
  capture queue and feeds them to the ASR/translate pipeline, emitting the
  resulting segments. It has the same cooperative ``Event``-signalled,
  join-on-stop lifecycle as :class:`~translator_app.audio.capture.LoopbackCapture`.
* :class:`Application` -- composes capture + ASR worker + overlay and exposes an
  idempotent, best-effort :meth:`Application.shutdown` that stops everything in
  reverse start order. Each component bounds its own join, so shutdown never
  hangs; one component failing does not prevent the others from stopping.

No PySide6 import here -- the shell is GUI-toolkit agnostic, so this module (and
its tests) run with nothing installed.
"""

from __future__ import annotations

import queue
import threading
from typing import Callable, List, Optional, Protocol, Tuple


class _Stoppable(Protocol):
    def stop(self) -> None: ...


class AsrWorker:
    """Daemon thread draining captured frames into the ASR/translate pipeline."""

    def __init__(
        self,
        frames: "queue.Queue[bytes]",
        pipeline,
        *,
        on_segment: Optional[Callable[[object], None]] = None,
        poll_timeout: float = 0.1,
    ) -> None:
        self.frames = frames
        self.pipeline = pipeline
        self.on_segment = on_segment
        self.poll_timeout = poll_timeout
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.is_running():
            raise RuntimeError("asr worker is already running")
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="asr-worker", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        # Poll with a timeout so the thread notices the stop signal even when no
        # audio is arriving (rather than blocking forever on an empty queue).
        while not self._stop.is_set():
            try:
                chunk = self.frames.get(timeout=self.poll_timeout)
            except queue.Empty:
                continue
            segments = self.pipeline.feed(chunk)
            if self.on_segment:
                for segment in segments:
                    self.on_segment(segment)

    def stop(self, timeout: float = 2.0) -> None:
        """Signal the worker to stop and join its thread. Idempotent."""
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
            self._thread = None


class Application:
    """Owns the runtime components and tears them down cleanly on exit."""

    def __init__(
        self,
        *,
        capture=None,
        asr_worker: Optional[AsrWorker] = None,
        overlay=None,
        teardown: Optional[List[Callable[[], None]]] = None,
    ) -> None:
        self.capture = capture
        self.asr_worker = asr_worker
        self.overlay = overlay
        self._extra_teardown = list(teardown or [])
        self._shut_down = False
        self.errors: List[Tuple[str, BaseException]] = []

    @property
    def is_shut_down(self) -> bool:
        return self._shut_down

    def start(self) -> None:
        """Start capture then the ASR worker (shutdown tears down in reverse)."""
        if self.capture is not None:
            self.capture.start()
        if self.asr_worker is not None:
            self.asr_worker.start()

    def shutdown(self) -> List[Tuple[str, BaseException]]:
        """Stop everything in reverse start order. Idempotent and best-effort.

        Returns the list of ``(component_name, exception)`` failures (empty on a
        clean shutdown). A failure in one component is recorded and the remaining
        components are still stopped, so a misbehaving stream can never strand a
        live capture or ASR thread.
        """
        if self._shut_down:
            return self.errors
        self._shut_down = True

        steps: List[Tuple[str, Callable[[], None]]] = []
        if self.asr_worker is not None:
            steps.append(("asr_worker", self.asr_worker.stop))
        if self.capture is not None:
            steps.append(("capture", self.capture.stop))
        if self.overlay is not None:
            close = getattr(self.overlay, "close", None)
            if callable(close):
                steps.append(("overlay", close))
        steps.extend((f"teardown[{i}]", fn) for i, fn in enumerate(self._extra_teardown))

        for name, fn in steps:
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - best-effort teardown; record and continue
                self.errors.append((name, exc))
        return self.errors
