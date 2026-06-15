"""Tests for the subtitle renderer (TASK-1107).

The timing/clearing logic and the appearance model are pure and tested directly.
The Qt label layer is verified by a real PySide6 offscreen smoke test (font
size, alignment, and displayed text), skipped if PySide6 is unavailable.

    python -m unittest discover -s tests
"""

import os
import sys
import unittest
from collections import namedtuple

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

Seg = namedtuple("Seg", "text start end is_final")


class SubtitleModelTest(unittest.TestCase):
    def _model(self, **kw):
        from translator_app.ui.subtitle_renderer import SubtitleModel

        kw.setdefault("hold_seconds", 3.0)
        kw.setdefault("max_lines", 2)
        return SubtitleModel(**kw)

    def test_partial_replaces_live_line_in_place(self):
        m = self._model()
        m.add_partial("こん", now=0.0)
        m.add_partial("こんにちは", now=0.5)
        lines = m.visible_lines(now=0.5)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].text, "こんにちは")
        self.assertFalse(lines[0].is_final)

    def test_final_promotes_the_live_partial(self):
        m = self._model()
        m.add_partial("Hello world", now=0.0)
        m.add_final("Hello", now=1.0)
        lines = m.visible_lines(now=1.0)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].text, "Hello")
        self.assertTrue(lines[0].is_final)

    def test_final_then_new_partial_appends(self):
        m = self._model()
        m.add_partial("Hello world", now=0.0)
        m.add_final("Hello", now=1.0)
        m.add_partial("world", now=1.2)
        lines = m.visible_lines(now=1.2)
        self.assertEqual([(l.text, l.is_final) for l in lines], [("Hello", True), ("world", False)])

    def test_consecutive_finals_append(self):
        m = self._model()
        m.add_final("X", now=0.0)
        m.add_final("Y", now=0.5)
        self.assertEqual([l.text for l in m.visible_lines(now=0.5)], ["X", "Y"])

    def test_stale_lines_clear_on_timing_rule(self):
        m = self._model(hold_seconds=3.0)
        m.add_final("old", now=0.0)
        self.assertEqual(len(m.visible_lines(now=2.9)), 1)
        self.assertEqual(len(m.visible_lines(now=3.1)), 0, "line older than hold_seconds must clear")

    def test_partial_refresh_extends_lifetime(self):
        m = self._model(hold_seconds=3.0)
        m.add_partial("a", now=0.0)
        m.add_partial("a longer", now=2.0)  # refresh resets the clock
        self.assertEqual(len(m.visible_lines(now=4.0)), 1)  # 4.0 - 2.0 < 3.0

    def test_max_lines_caps_history(self):
        m = self._model(max_lines=2)
        m.add_final("one", now=0.0)
        m.add_final("two", now=0.1)
        m.add_final("three", now=0.2)
        self.assertEqual([l.text for l in m.visible_lines(now=0.2)], ["two", "three"])

    def test_ingest_routes_by_is_final(self):
        m = self._model()
        m.ingest(Seg("partial", 0.0, 1.0, False), now=0.0)
        m.ingest(Seg("final", 0.0, 1.0, True), now=1.0)
        lines = m.visible_lines(now=1.0)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].text, "final")
        self.assertTrue(lines[0].is_final)


class SubtitleStyleTest(unittest.TestCase):
    def test_opacity_clamped_to_unit_interval(self):
        from translator_app.ui.subtitle_renderer import SubtitleStyle

        self.assertEqual(SubtitleStyle(background_opacity=1.5).background_opacity, 1.0)
        self.assertEqual(SubtitleStyle(background_opacity=-0.2).background_opacity, 0.0)

    def test_background_css_maps_opacity_to_alpha(self):
        from translator_app.ui.subtitle_renderer import SubtitleStyle

        self.assertEqual(SubtitleStyle(background_opacity=0.5).background_css(), "rgba(0,0,0,128)")
        self.assertEqual(SubtitleStyle(background_opacity=0.0).background_css(), "rgba(0,0,0,0)")

    def test_font_size_has_minimum(self):
        from translator_app.ui.subtitle_renderer import SubtitleStyle

        self.assertGreaterEqual(SubtitleStyle(font_size_pt=0).font_size_pt, 1)

    def test_position_maps_to_alignment(self):
        from translator_app.ui.subtitle_renderer import SubtitlePosition, SubtitleStyle, alignment_flag_names

        bottom = alignment_flag_names(SubtitleStyle(position=SubtitlePosition.BOTTOM))
        self.assertIn("AlignHCenter", bottom)
        self.assertIn("AlignBottom", bottom)
        top = alignment_flag_names(SubtitleStyle(position=SubtitlePosition.TOP))
        self.assertIn("AlignTop", top)


class SubtitleRendererQtTest(unittest.TestCase):
    def test_applies_style_and_displays_visible_lines(self):
        try:
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
            from PySide6 import QtWidgets  # noqa: F401
        except ImportError:
            self.skipTest("PySide6 not installed")

        from translator_app.ui.subtitle_renderer import (
            SubtitlePosition,
            SubtitleRenderer,
            SubtitleStyle,
        )

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        renderer = SubtitleRenderer(style=SubtitleStyle(font_size_pt=40, position=SubtitlePosition.BOTTOM))
        renderer.ingest(Seg("Hello", 0.0, 1.0, True), now=0.0)
        renderer.ingest(Seg("world", 1.0, 2.0, False), now=0.1)

        text = renderer.update_display(now=0.1)
        self.assertEqual(text, "Hello\nworld")
        self.assertEqual(renderer.widget.font().pointSize(), 40)

        renderer.widget.deleteLater()
        del app


if __name__ == "__main__":
    unittest.main()
