"""Tests for the full-screen transparent overlay window (TASK-1106).

PySide6 is not installed here, so the construction logic is exercised by
injecting a fake Qt module that records the flags/attributes/geometry applied.
A real-Qt smoke test is included but skips unless PySide6 is importable.

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


# --- fake Qt ---------------------------------------------------------------

class _FakeQt:
    # window flags as ints so they OR together like real enums
    FramelessWindowHint = 0x1
    WindowStaysOnTopHint = 0x2
    Tool = 0x4
    WindowTransparentForInput = 0x8
    # widget attributes as sentinels
    WA_TranslucentBackground = "WA_TranslucentBackground"
    WA_NoSystemBackground = "WA_NoSystemBackground"
    WA_TransparentForMouseEvents = "WA_TransparentForMouseEvents"
    WA_ShowWithoutActivating = "WA_ShowWithoutActivating"


class _FakeQtCore:
    Qt = _FakeQt


class FakeWidget:
    def __init__(self):
        self.flags = None
        self.attributes = []
        self.geometry = None

    def setWindowFlags(self, flags):
        self.flags = flags

    def setAttribute(self, attr, on):
        self.attributes.append((attr, on))

    def setGeometry(self, geom):
        self.geometry = geom


class _FakeScreen:
    def geometry(self):
        return "FULLSCREEN_GEOM"


class _FakeQtWidgets:
    QWidget = FakeWidget

    class QApplication:
        @staticmethod
        def primaryScreen():
            return _FakeScreen()


class FakeQtModules:
    QtCore = _FakeQtCore
    QtWidgets = _FakeQtWidgets


# --- tests -----------------------------------------------------------------

class FlagSpecTest(unittest.TestCase):
    def test_default_flags_are_overlay_appropriate(self):
        from translator_app.ui.overlay_window import OverlayConfig, window_flag_names

        names = window_flag_names(OverlayConfig())
        self.assertEqual(
            names,
            ["FramelessWindowHint", "WindowStaysOnTopHint", "Tool", "WindowTransparentForInput"],
        )

    def test_default_attributes_include_transparency_and_click_through(self):
        from translator_app.ui.overlay_window import OverlayConfig, widget_attribute_names

        names = widget_attribute_names(OverlayConfig())
        self.assertIn("WA_TranslucentBackground", names)
        self.assertIn("WA_TransparentForMouseEvents", names)
        self.assertIn("WA_ShowWithoutActivating", names)

    def test_click_through_can_be_disabled(self):
        from translator_app.ui.overlay_window import OverlayConfig, widget_attribute_names, window_flag_names

        cfg = OverlayConfig(click_through=False)
        self.assertNotIn("WA_TransparentForMouseEvents", widget_attribute_names(cfg))
        self.assertNotIn("WindowTransparentForInput", window_flag_names(cfg))


class BuildOverlayTest(unittest.TestCase):
    def test_applies_flags_attributes_and_fullscreen_geometry(self):
        from translator_app.ui.overlay_window import (
            OverlayConfig,
            build_overlay,
            widget_attribute_names,
        )

        cfg = OverlayConfig()
        widget = build_overlay(cfg, qt_modules=FakeQtModules())

        # flags ORed: 0x1|0x2|0x4|0x8 == 0xF
        self.assertEqual(widget.flags, 0xF)
        applied = [name for name, on in widget.attributes]
        self.assertEqual(applied, widget_attribute_names(cfg))
        self.assertTrue(all(on is True for _name, on in widget.attributes))
        self.assertEqual(widget.geometry, "FULLSCREEN_GEOM")

    def test_non_fullscreen_skips_geometry(self):
        from translator_app.ui.overlay_window import OverlayConfig, build_overlay

        widget = build_overlay(OverlayConfig(fullscreen=False), qt_modules=FakeQtModules())
        self.assertIsNone(widget.geometry)


class ControlsWindowTest(unittest.TestCase):
    """The controls window must stay interactive, unlike the subtitle canvas.

    Regression guard for the packaged-app bug where the exit button and settings
    bar were children of the click-through overlay, so every click fell through
    them to the desktop. The controls live in their own non-click-through window.
    """

    def test_controls_window_is_not_click_through(self):
        from translator_app.ui.overlay_window import build_controls_window

        widget = build_controls_window(qt_modules=FakeQtModules())

        # No transparent-for-input flag (0x8) and no mouse-transparent attribute:
        self.assertFalse(widget.flags & _FakeQt.WindowTransparentForInput)
        applied = [name for name, on in widget.attributes]
        self.assertNotIn("WA_TransparentForMouseEvents", applied)

    def test_controls_window_stays_frameless_on_top_tool_translucent(self):
        from translator_app.ui.overlay_window import build_controls_window

        widget = build_controls_window(qt_modules=FakeQtModules())

        # Frameless(0x1) | OnTop(0x2) | Tool(0x4) == 0x7, no transparent-for-input.
        self.assertEqual(widget.flags, 0x7)
        applied = [name for name, on in widget.attributes]
        self.assertIn("WA_TranslucentBackground", applied)
        self.assertIn("WA_ShowWithoutActivating", applied)


class NativeClickThroughTest(unittest.TestCase):
    def test_is_safe_when_winid_unavailable(self):
        from translator_app.ui.overlay_window import enable_windows_click_through

        class BadWindow:
            def winId(self):
                raise RuntimeError("no native handle yet")

        # Must never raise; returns False when it can't apply the style.
        self.assertFalse(enable_windows_click_through(BadWindow()))

    def test_topmost_is_safe_when_winid_unavailable(self):
        from translator_app.ui.overlay_window import enable_windows_topmost

        class BadWindow:
            def winId(self):
                raise RuntimeError("no native handle yet")

        # Must never raise; returns False when it can't pin the window.
        self.assertFalse(enable_windows_topmost(BadWindow()))


class RealQtSmokeTest(unittest.TestCase):
    def test_constructs_with_real_pyside6(self):
        try:
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
            from PySide6 import QtWidgets  # noqa: F401
        except ImportError:
            self.skipTest("PySide6 not installed")

        from translator_app.ui.overlay_window import build_overlay

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        widget = build_overlay()
        self.assertIsNotNone(widget)
        widget.deleteLater()
        del app


if __name__ == "__main__":
    unittest.main()
