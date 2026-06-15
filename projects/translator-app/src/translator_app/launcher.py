"""Real launch flow that assembles the running app (TASK-1111).

This is the integration layer the packaged ``.exe`` runs: it wires together the
pieces built across TASK-1102..TASK-1110 -- device pick, loopback capture, the
ASR/translate pipeline + worker, the transparent overlay, the subtitle renderer,
the auto-hiding settings bar, exit controls, and the latency/accuracy
reconfigurator -- and runs the Qt event loop.

Everything heavy (PySide6, faster-whisper, PyAudioWPatch) is imported lazily
inside :func:`run`, so importing this module stays cheap and dependency-free.
:func:`run` itself is the thin native layer -- like the rest of the GUI code it
is exercised on a real Windows desktop, not in the headless test suite.

Cross-thread rule
-----------------
The ASR worker runs off-thread, so it must not touch Qt. It only drops finished
segments onto a thread-safe queue; a ``QTimer`` on the GUI thread drains that
queue into the subtitle renderer. That is the one place capture/ASR and the UI
meet, and it meets through a queue on purpose.
"""

from __future__ import annotations

import queue
import time


def run() -> int:
    """Assemble and run the overlay app. Returns a process exit code."""
    from PySide6 import QtCore, QtWidgets  # noqa: PLC0415 (lazy: heavy GUI dep)

    from .app import Application, AsrWorker
    from .audio.capture import LoopbackCapture, PyAudioWPatchCaptureBackend
    from .audio.devices import PyAudioWPatchBackend, enumerate_loopback_devices
    from .settings import (
        build_default_transcriber,
        default_pipeline_factory,
        default_settings,
        PipelineReconfigurator,
    )
    from .ui.exit_controls import ExitButton, bind_exit_routes
    from .ui.overlay_window import (
        build_controls_window,
        build_overlay,
        enable_windows_click_through,
    )
    from .ui.settings_bar import RevealPolicy, SettingsBarWidget
    from .ui.subtitle_renderer import SubtitleRenderer

    qt_app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])

    # --- audio device ------------------------------------------------------
    # Windowed builds have no console for a picker, so auto-select the first
    # loopback device; run from source (`python -m translator_app --launch`) to
    # use the interactive console picker if you have several.
    device_backend = PyAudioWPatchBackend()
    devices = enumerate_loopback_devices(device_backend)
    if not devices:
        raise SystemExit(
            "No loopback-capable audio devices found. Enable a WASAPI output device and retry."
        )
    device = devices[0]

    capture = LoopbackCapture(device, PyAudioWPatchCaptureBackend())

    # --- settings + pipeline ----------------------------------------------
    settings = default_settings()
    from .ui.settings_bar import SettingsController  # noqa: PLC0415

    controller = SettingsController(settings)
    make_pipeline = default_pipeline_factory(
        input_rate=capture.format.sample_rate, input_channels=capture.format.channels
    )
    transcriber = build_default_transcriber(settings.model_size, settings.language_pair)
    worker = AsrWorker(capture.frames, make_pipeline(transcriber))

    PipelineReconfigurator(
        controller,
        build_transcriber=build_default_transcriber,
        make_pipeline=make_pipeline,
        on_pipeline=worker.set_pipeline,
    )

    # --- overlay + UI ------------------------------------------------------
    # Two windows on purpose: the subtitle canvas is fully click-through so it
    # never steals clicks from the show underneath, while the controls live in a
    # separate *interactive* window -- otherwise the exit button and settings bar
    # would be painted but un-clickable (every press falls through the overlay).
    overlay = build_overlay()
    renderer = SubtitleRenderer(parent=overlay)
    renderer.widget.setParent(overlay)

    controls = build_controls_window()
    settings_bar = SettingsBarWidget(controller=controller, parent=controls)

    # ASR worker (off-thread) -> queue -> GUI-thread QTimer -> renderer
    segments: "queue.Queue[object]" = queue.Queue()
    worker.on_segment = segments.put

    def drain_segments() -> None:
        now = time.monotonic()
        drained = False
        while True:
            try:
                segment = segments.get_nowait()
            except queue.Empty:
                break
            renderer.ingest(segment, now=now)
            drained = True
        if drained:
            renderer.update_display(now)

    timer = QtCore.QTimer()
    timer.setInterval(100)  # ms
    timer.timeout.connect(drain_segments)

    # --- exit wiring -------------------------------------------------------
    app = Application(
        capture=capture,
        asr_worker=worker,
        overlay=overlay,
        teardown=[timer.stop, device_backend.close],
    )

    def on_exit() -> None:
        app.shutdown()
        qt_app.quit()

    exit_button = ExitButton(on_exit=on_exit, parent=controls)
    bind_exit_routes(controller, on_exit, exit_button=exit_button)

    # --- show + start ------------------------------------------------------
    overlay.showFullScreen()
    enable_windows_click_through(overlay)  # best-effort; needs a realized handle

    # Controls window: a thin, full-width interactive strip pinned to the top.
    # NOT click-through (no enable_windows_click_through call) so it gets clicks.
    reveal = RevealPolicy()
    screen_geometry = overlay.geometry()
    screen_width = screen_geometry.width()
    controls.setGeometry(0, 0, screen_width, reveal.bar_height_px)
    controls.setMouseTracking(True)

    # Hover-reveal: the settings bar hides until the pointer reaches the top edge,
    # then stays while the pointer is over the bar (RevealPolicy hysteresis).
    class _RevealFilter(QtCore.QObject):
        def eventFilter(self, _obj, event):
            if event.type() == QtCore.QEvent.Type.MouseMove:
                mouse_y = event.position().y()
                if reveal.should_be_visible(mouse_y, currently_visible=settings_bar.is_revealed):
                    settings_bar.reveal()
                else:
                    settings_bar.conceal()
            return False

    reveal_filter = _RevealFilter()
    controls.installEventFilter(reveal_filter)
    # Keep a reference so the filter isn't garbage-collected while the app runs.
    controls._reveal_filter = reveal_filter  # type: ignore[attr-defined]

    controls.show()
    controls.raise_()
    exit_button.position_top_right(screen_width)
    exit_button.widget.show()
    settings_bar.conceal()  # starts hidden; the reveal filter shows it on hover

    app.start()
    timer.start()
    return int(qt_app.exec())
