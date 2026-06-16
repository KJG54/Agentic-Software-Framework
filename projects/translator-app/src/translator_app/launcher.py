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
from dataclasses import replace


def run() -> int:
    """Assemble and run the overlay app. Returns a process exit code."""
    from PySide6 import QtCore, QtGui, QtWidgets  # noqa: PLC0415 (lazy: heavy GUI dep)

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
        enable_windows_topmost,
    )
    from .ui.settings_bar import RevealPolicy, SettingsBarWidget
    from .ui.subtitle_renderer import (
        alignment_flag_names,
        SubtitleRenderer,
        SubtitleStyle,
    )

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

    # Caption: start from the current settings and lay it out where the user
    # expects (default bottom-centre). The label is *content-sized* inside the
    # layout, so its translucent text background covers only the words -- a
    # full-screen label would tint the whole display. Without this layout the
    # label sat at (0,0) at a tiny default size, which is why captions were
    # invisible / clipped into the top-left corner.
    initial_style = SubtitleStyle(
        font_size_pt=settings.font_size_pt,
        position=settings.position,
        background_opacity=settings.background_opacity,
    )
    renderer = SubtitleRenderer(parent=overlay, style=initial_style)
    caption_layout = QtWidgets.QVBoxLayout(overlay)
    caption_layout.setContentsMargins(0, 0, 0, 0)
    caption_layout.addWidget(renderer.widget)

    def _resolve_alignment(style):
        align = None
        for flag_name in alignment_flag_names(style):
            flag = getattr(QtCore.Qt.AlignmentFlag, flag_name)
            align = flag if align is None else align | flag
        return align

    def apply_caption_position() -> None:
        caption_layout.setAlignment(renderer.widget, _resolve_alignment(renderer.style))

    apply_caption_position()

    controls = build_controls_window()
    settings_bar = SettingsBarWidget(controller=controller, parent=controls)

    # The reconfigurator already rebuilds the pipeline for model/language changes;
    # wire the *appearance* knobs (font size, position, opacity) to the live
    # caption here so the settings bar actually changes what's on screen.
    def on_appearance_change(change) -> None:
        if change.field == "font_size_pt":
            renderer.set_style(replace(renderer.style, font_size_pt=change.value))
        elif change.field == "background_opacity":
            renderer.set_style(replace(renderer.style, background_opacity=change.value))
        elif change.field == "position":
            renderer.set_style(replace(renderer.style, position=change.value))
            apply_caption_position()

    controller.subscribe(on_appearance_change)

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

    # Created here so its .stop is in the teardown list; configured below once the
    # screen geometry is known.
    reveal_timer = QtCore.QTimer()

    # --- exit wiring -------------------------------------------------------
    app = Application(
        capture=capture,
        asr_worker=worker,
        overlay=overlay,
        teardown=[timer.stop, reveal_timer.stop, device_backend.close],
    )

    def on_exit() -> None:
        app.shutdown()
        qt_app.quit()

    exit_button = ExitButton(on_exit=on_exit, parent=controls)
    bind_exit_routes(controller, on_exit, exit_button=exit_button)

    # --- show + start ------------------------------------------------------
    overlay.showFullScreen()
    enable_windows_click_through(overlay)  # best-effort; needs a realized handle

    reveal = RevealPolicy(reveal_zone_px=3)  # the *very top* edge
    reveal_dwell_ms = 1000  # pointer must rest at the top for ~1s before revealing
    screen_geometry = overlay.geometry()
    screen_width = screen_geometry.width()

    # Cap caption width so long lines wrap instead of running off the screen.
    caption_max = max(320, screen_width - 2 * renderer.style.margin_px)
    renderer.widget.setMaximumWidth(caption_max)

    # Controls window: a thin, full-width interactive strip pinned to the top, held
    # ABOVE the click-through overlay (enable_windows_topmost) so its buttons get
    # real mouse clicks -- Qt's raise_() only orders within the app, not against
    # another top-level always-on-top window.
    controls.setGeometry(0, 0, screen_width, reveal.bar_height_px)
    settings_bar.widget.setGeometry(0, 0, screen_width, reveal.bar_height_px)
    controls.show()
    controls.raise_()
    enable_windows_topmost(controls)
    exit_button.position_top_right(screen_width)
    exit_button.widget.raise_()
    exit_button.widget.show()
    settings_bar.conceal()  # hidden until the pointer dwells at the very top

    # Hover-reveal by polling the *global* cursor position (an event filter on the
    # thin translucent window proved unreliable). The bar stays hidden until the
    # pointer rests at the very top edge for ~1s, then shows while the pointer is
    # over the bar; a popup guard keeps it open while a combo dropdown is showing.
    dwell = {"ms": 0}

    def update_reveal() -> None:
        if QtWidgets.QApplication.activePopupWidget() is not None:
            return
        cursor_y = QtGui.QCursor.pos().y() - screen_geometry.y()
        if settings_bar.is_revealed:
            if cursor_y > reveal.bar_height_px:
                settings_bar.conceal()
                dwell["ms"] = 0
            return
        if cursor_y <= reveal.reveal_zone_px:
            dwell["ms"] += reveal_timer.interval()
            if dwell["ms"] >= reveal_dwell_ms:
                settings_bar.reveal()
                settings_bar.widget.raise_()
                enable_windows_topmost(controls)
        else:
            dwell["ms"] = 0

    reveal_timer.setInterval(100)  # ms
    reveal_timer.timeout.connect(update_reveal)

    app.start()
    timer.start()
    reveal_timer.start()
    return int(qt_app.exec())
