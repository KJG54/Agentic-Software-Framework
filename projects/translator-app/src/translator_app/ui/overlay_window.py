"""Full-screen transparent click-through overlay window (TASK-1106).

This is the canvas the subtitle renderer (TASK-1107) draws on and the settings
bar (TASK-1108) attaches to: a frameless, fully transparent, always-on-top
window that covers the whole screen and lets mouse/keyboard fall through to the
application beneath.

Design
------
The *decision* about which Qt window flags and widget attributes an overlay
needs is pure data (:func:`window_flag_names` / :func:`widget_attribute_names`)
so it can be unit-tested without a display. :func:`build_overlay` applies that
decision to a real ``QWidget``; PySide6 is lazy-imported and the Qt module is
injectable so construction can be exercised headlessly with a fake.

Click-through
-------------
Two layers, because Qt alone isn't fully reliable on Windows:

* Qt: ``WindowTransparentForInput`` flag + ``WA_TransparentForMouseEvents`` make
  the window ignore input.
* Native (Windows): :func:`enable_windows_click_through` adds the
  ``WS_EX_LAYERED | WS_EX_TRANSPARENT`` extended styles so clicks reach windows
  *behind* the overlay. It must be called after the window is shown (it needs a
  realized native handle) and is best-effort -- it never raises.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class OverlayConfig:
    fullscreen: bool = True
    always_on_top: bool = True
    frameless: bool = True
    tool_window: bool = True  # keep out of the taskbar / alt-tab
    translucent: bool = True
    click_through: bool = True


def window_flag_names(config: OverlayConfig) -> List[str]:
    """Names of the ``Qt`` window flags this overlay needs."""
    names: List[str] = []
    if config.frameless:
        names.append("FramelessWindowHint")
    if config.always_on_top:
        names.append("WindowStaysOnTopHint")
    if config.tool_window:
        names.append("Tool")
    if config.click_through:
        names.append("WindowTransparentForInput")
    return names


def widget_attribute_names(config: OverlayConfig) -> List[str]:
    """Names of the ``Qt`` widget attributes this overlay needs."""
    names: List[str] = []
    if config.translucent:
        names.append("WA_TranslucentBackground")
        names.append("WA_NoSystemBackground")
    if config.click_through:
        names.append("WA_TransparentForMouseEvents")
    names.append("WA_ShowWithoutActivating")  # never steal focus from the app beneath
    return names


def _resolve(qt, name: str, enum_class: str):
    """Look up a Qt enum member, preferring the scoped enum class.

    PySide6 6.x exposes members as ``Qt.WindowType.FramelessWindowHint`` rather
    than flat on ``Qt``; older versions and the test fake keep them flat, so we
    try the scoped class first and fall back to the namespace.
    """
    scope = getattr(qt, enum_class, None)
    if scope is not None and hasattr(scope, name):
        return getattr(scope, name)
    return getattr(qt, name)


def _import_qt():
    from PySide6 import QtCore, QtWidgets  # noqa: PLC0415 (lazy: optional GUI dep)

    class _Modules:
        pass

    modules = _Modules()
    modules.QtCore = QtCore
    modules.QtWidgets = QtWidgets
    return modules


def build_overlay(config: Optional[OverlayConfig] = None, *, qt_modules=None):
    """Create and configure the overlay ``QWidget`` (not yet shown).

    ``qt_modules`` (with ``.QtCore`` / ``.QtWidgets``) is injectable for headless
    testing; by default PySide6 is imported lazily. Caller shows it with
    ``showFullScreen()`` and then calls :func:`enable_windows_click_through`.
    """
    config = config or OverlayConfig()
    mods = qt_modules or _import_qt()
    Qt = mods.QtCore.Qt
    widget = mods.QtWidgets.QWidget()

    flags = None
    for name in window_flag_names(config):
        flag = _resolve(Qt, name, "WindowType")
        flags = flag if flags is None else flags | flag
    if flags is not None:
        widget.setWindowFlags(flags)

    for name in widget_attribute_names(config):
        widget.setAttribute(_resolve(Qt, name, "WidgetAttribute"), True)

    if config.fullscreen:
        screen = mods.QtWidgets.QApplication.primaryScreen()
        if screen is not None:
            widget.setGeometry(screen.geometry())

    return widget


def build_controls_window(*, qt_modules=None):
    """Create the interactive controls window the exit button + settings bar live in.

    The subtitle canvas from :func:`build_overlay` is fully click-through, which
    is correct for captions but fatal for controls: a button parented to it can
    be *seen* but never *clicked* -- the press falls straight through to whatever
    is behind the overlay. So the controls get their own top-level window that is
    still frameless, always-on-top, tool-style and translucent, but **not**
    click-through, so it actually receives mouse input. ``fullscreen=False`` so
    the caller can size it to a thin top strip; :func:`enable_windows_click_through`
    must *not* be applied to it.
    """
    return build_overlay(
        OverlayConfig(fullscreen=False, click_through=False), qt_modules=qt_modules
    )


def enable_windows_click_through(window) -> bool:
    """Best-effort: add ``WS_EX_LAYERED | WS_EX_TRANSPARENT`` so clicks fall through.

    Windows-only; returns ``True`` when applied, ``False`` otherwise (wrong
    platform or no realized native handle yet). Never raises.
    """
    if sys.platform != "win32":
        return False
    try:
        import ctypes  # noqa: PLC0415 (lazy, Windows-only)

        hwnd = int(window.winId())
        GWL_EXSTYLE = -20
        WS_EX_LAYERED = 0x00080000
        WS_EX_TRANSPARENT = 0x00000020
        user32 = ctypes.windll.user32
        ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED | WS_EX_TRANSPARENT)
        return True
    except Exception:
        return False
