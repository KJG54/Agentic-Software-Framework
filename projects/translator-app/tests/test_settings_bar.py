"""Tests for the auto-hiding settings bar (TASK-1108).

The settings *state* + change-event bus and the hover reveal/hide policy are
pure and tested directly. The Qt bar widget (populated controls, default-hidden,
control->event wiring, exit button) is verified by a real PySide6 offscreen
smoke test, skipped if PySide6 is unavailable.

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


class SettingsStateTest(unittest.TestCase):
    def test_defaults_match_subtitle_and_ja_en(self):
        from translator_app.translate.interface import LanguagePair
        from translator_app.ui.settings_bar import ModelSize, SettingsState
        from translator_app.ui.subtitle_renderer import SubtitlePosition

        state = SettingsState()
        self.assertEqual(state.language_pair, LanguagePair("ja", "en"))
        self.assertEqual(state.font_size_pt, 32)
        self.assertEqual(state.position, SubtitlePosition.BOTTOM)
        self.assertEqual(state.background_opacity, 0.5)
        self.assertEqual(state.model_size, ModelSize.SMALL)


class ModelSizeTest(unittest.TestCase):
    def test_values_are_faster_whisper_names(self):
        from translator_app.ui.settings_bar import ModelSize

        self.assertEqual(ModelSize.TINY.value, "tiny")
        self.assertEqual(ModelSize.LARGE.value, "large-v3")

    def test_ordered_runs_fast_to_accurate(self):
        from translator_app.ui.settings_bar import ModelSize

        ordered = ModelSize.ordered()
        self.assertEqual(ordered[0], ModelSize.TINY, "fastest first")
        self.assertEqual(ordered[-1], ModelSize.LARGE, "most accurate last")
        self.assertEqual(len(ordered), len(set(ordered)))


class SettingsControllerTest(unittest.TestCase):
    def _controller(self):
        from translator_app.ui.settings_bar import SettingsController

        c = SettingsController()
        events = []
        c.subscribe(events.append)
        return c, events

    def test_set_language_pair_emits_event(self):
        from translator_app.translate.interface import LanguagePair

        c, events = self._controller()
        c.set_language_pair(LanguagePair("ja", "en"))
        self.assertEqual(events[-1].field, "language_pair")
        self.assertEqual(events[-1].value, LanguagePair("ja", "en"))
        self.assertEqual(c.state.language_pair, LanguagePair("ja", "en"))

    def test_set_position_emits_event(self):
        from translator_app.ui.subtitle_renderer import SubtitlePosition

        c, events = self._controller()
        c.set_position(SubtitlePosition.TOP)
        self.assertEqual(events[-1].field, "position")
        self.assertEqual(events[-1].value, SubtitlePosition.TOP)

    def test_set_model_size_emits_event(self):
        from translator_app.ui.settings_bar import ModelSize

        c, events = self._controller()
        c.set_model_size(ModelSize.MEDIUM)
        self.assertEqual(events[-1].field, "model_size")
        self.assertEqual(events[-1].value, ModelSize.MEDIUM)

    def test_font_size_is_clamped_to_minimum(self):
        c, events = self._controller()
        c.set_font_size(0)
        self.assertGreaterEqual(c.state.font_size_pt, 1)
        self.assertEqual(events[-1].value, c.state.font_size_pt)

    def test_opacity_is_clamped_to_unit_interval(self):
        c, events = self._controller()
        c.set_opacity(1.5)
        self.assertEqual(c.state.background_opacity, 1.0)
        c.set_opacity(-0.3)
        self.assertEqual(c.state.background_opacity, 0.0)

    def test_multiple_subscribers_all_notified(self):
        from translator_app.ui.settings_bar import ModelSize, SettingsController

        c = SettingsController()
        a, b = [], []
        c.subscribe(a.append)
        c.subscribe(b.append)
        c.set_model_size(ModelSize.TINY)
        self.assertEqual(len(a), 1)
        self.assertEqual(len(b), 1)

    def test_exit_uses_a_separate_channel(self):
        from translator_app.ui.settings_bar import SettingsController

        c = SettingsController()
        changes, exits = [], []
        c.subscribe(changes.append)
        c.subscribe_exit(lambda: exits.append(True))
        c.request_exit()
        self.assertEqual(exits, [True])
        self.assertEqual(changes, [], "exit is not a settings change")


class RevealPolicyTest(unittest.TestCase):
    def _policy(self):
        from translator_app.ui.settings_bar import RevealPolicy

        return RevealPolicy(reveal_zone_px=4, bar_height_px=48)

    def test_hidden_by_default_away_from_top(self):
        p = self._policy()
        self.assertFalse(p.should_be_visible(200, currently_visible=False))

    def test_reveals_when_pointer_reaches_top_edge(self):
        p = self._policy()
        self.assertTrue(p.should_be_visible(2, currently_visible=False))

    def test_stays_visible_while_hovering_the_bar(self):
        p = self._policy()
        # below the 4px reveal zone but still over the 48px bar
        self.assertTrue(p.should_be_visible(30, currently_visible=True))

    def test_hides_once_pointer_leaves_the_bar(self):
        p = self._policy()
        self.assertFalse(p.should_be_visible(60, currently_visible=True))


class SettingsBarWidgetQtTest(unittest.TestCase):
    def _qt(self):
        try:
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
            from PySide6 import QtWidgets
        except ImportError:
            self.skipTest("PySide6 not installed")
        return QtWidgets

    def test_builds_hidden_with_populated_controls(self):
        QtWidgets = self._qt()
        from translator_app.ui.settings_bar import ModelSize, SettingsBarWidget
        from translator_app.translate.interface import supported_pairs

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        bar = SettingsBarWidget()

        self.assertFalse(bar.is_revealed, "bar must start hidden")
        self.assertEqual(bar.language_combo.count(), len(supported_pairs()))
        self.assertEqual(bar.model_combo.count(), len(ModelSize.ordered()))
        self.assertGreater(bar.position_combo.count(), 0)

        bar.widget.deleteLater()
        del app

    def test_changing_a_control_emits_an_event(self):
        QtWidgets = self._qt()
        from translator_app.ui.settings_bar import ModelSize, SettingsBarWidget

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        bar = SettingsBarWidget()
        events = []
        bar.controller.subscribe(events.append)

        # select a model size other than the current one
        target = ModelSize.LARGE
        bar.model_combo.setCurrentIndex(ModelSize.ordered().index(target))

        self.assertTrue(any(e.field == "model_size" and e.value == target for e in events))
        self.assertEqual(bar.controller.state.model_size, target)

        bar.widget.deleteLater()
        del app

    def test_exit_button_triggers_exit_channel(self):
        QtWidgets = self._qt()
        from translator_app.ui.settings_bar import SettingsBarWidget

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        bar = SettingsBarWidget()
        exits = []
        bar.controller.subscribe_exit(lambda: exits.append(True))

        bar.exit_button.click()
        self.assertEqual(exits, [True])

        bar.widget.deleteLater()
        del app

    def test_reveal_and_conceal_toggle_visibility_flag(self):
        QtWidgets = self._qt()
        from translator_app.ui.settings_bar import SettingsBarWidget

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        bar = SettingsBarWidget()
        bar.reveal()
        self.assertTrue(bar.is_revealed)
        bar.conceal()
        self.assertFalse(bar.is_revealed)

        bar.widget.deleteLater()
        del app


if __name__ == "__main__":
    unittest.main()
