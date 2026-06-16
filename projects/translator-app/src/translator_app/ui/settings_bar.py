"""Auto-hiding settings bar for the overlay (TASK-1108).

A thin strip of controls that lives at the top of the screen, stays hidden, and
reveals on hover. It exposes the knobs the user changes while watching: the
language pair, subtitle appearance (font size, position, opacity), the
latency-vs-accuracy model size, and an exit button.

Design (same split as the rest of the UI)
------------------------------------------
* :class:`SettingsController` -- pure state plus a tiny pub/sub. Every control
  change is published as a :class:`SettingsChange` event the app subscribes to
  (TASK-1110 wires those to the live pipeline/renderer); exit is a separate
  channel because it is an action, not a setting.
* :class:`RevealPolicy` -- pure hover hysteresis: the bar appears when the
  pointer reaches the very top edge and stays while the pointer is over the bar,
  so it does not flicker. No Qt needed, so it is unit-tested directly.
* :class:`SettingsBarWidget` -- the ``QWidget`` that builds the controls and
  wires them to the controller. PySide6 is lazy-imported and injectable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, List, Optional

from translator_app.translate.interface import LanguagePair
from translator_app.ui.subtitle_renderer import SubtitlePosition


class ModelSize(Enum):
    """faster-whisper model sizes, the latency-vs-accuracy knob.

    Values are the strings faster-whisper expects; :meth:`ordered` runs from
    fastest/least accurate to slowest/most accurate.
    """

    TINY = "tiny"
    BASE = "base"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large-v3"

    @classmethod
    def ordered(cls) -> List["ModelSize"]:
        return [cls.TINY, cls.BASE, cls.SMALL, cls.MEDIUM, cls.LARGE]


@dataclass
class SettingsState:
    """The current, ephemeral settings (no persistence -- reset each run)."""

    language_pair: LanguagePair = field(default_factory=lambda: LanguagePair("ja", "en"))
    font_size_pt: int = 32
    position: SubtitlePosition = SubtitlePosition.BOTTOM
    background_opacity: float = 0.5
    model_size: ModelSize = ModelSize.SMALL


@dataclass(frozen=True)
class SettingsChange:
    """A single control change, delivered to subscribers."""

    field: str
    value: object


class SettingsController:
    """Holds :class:`SettingsState` and publishes changes to subscribers."""

    def __init__(self, state: Optional[SettingsState] = None) -> None:
        self.state = state or SettingsState()
        self._listeners: List[Callable[[SettingsChange], None]] = []
        self._exit_listeners: List[Callable[[], None]] = []

    def subscribe(self, callback: Callable[[SettingsChange], None]) -> Callable:
        """Register ``callback`` for every settings change. Returns it for chaining."""
        self._listeners.append(callback)
        return callback

    def subscribe_exit(self, callback: Callable[[], None]) -> Callable:
        """Register ``callback`` for the exit action."""
        self._exit_listeners.append(callback)
        return callback

    def _emit(self, field_name: str, value: object) -> None:
        change = SettingsChange(field_name, value)
        for listener in list(self._listeners):
            listener(change)

    def set_language_pair(self, pair: LanguagePair) -> None:
        self.state.language_pair = pair
        self._emit("language_pair", pair)

    def set_font_size(self, points: int) -> None:
        self.state.font_size_pt = max(1, int(points))
        self._emit("font_size_pt", self.state.font_size_pt)

    def set_position(self, position: SubtitlePosition) -> None:
        self.state.position = position
        self._emit("position", position)

    def set_opacity(self, opacity: float) -> None:
        self.state.background_opacity = min(1.0, max(0.0, float(opacity)))
        self._emit("background_opacity", self.state.background_opacity)

    def set_model_size(self, model_size: ModelSize) -> None:
        self.state.model_size = model_size
        self._emit("model_size", model_size)

    def request_exit(self) -> None:
        for listener in list(self._exit_listeners):
            listener()


@dataclass(frozen=True)
class RevealPolicy:
    """Hover hysteresis for showing/hiding the bar from the pointer's Y position."""

    reveal_zone_px: int = 4
    bar_height_px: int = 48

    def should_be_visible(self, mouse_y: float, *, currently_visible: bool) -> bool:
        """True if the bar should be shown for a pointer at ``mouse_y``.

        Appears when the pointer reaches the top ``reveal_zone_px`` edge; once
        visible, stays while the pointer is still over the bar (``bar_height_px``)
        so small movements do not make it flicker.
        """
        if mouse_y <= self.reveal_zone_px:
            return True
        if currently_visible and mouse_y <= self.bar_height_px:
            return True
        return False


def _import_qt():
    from PySide6 import QtCore, QtWidgets  # noqa: PLC0415 (lazy: optional GUI dep)

    class _Modules:
        pass

    modules = _Modules()
    modules.QtCore = QtCore
    modules.QtWidgets = QtWidgets
    return modules


class SettingsBarWidget:
    """A top-of-screen ``QWidget`` of controls wired to a :class:`SettingsController`.

    Starts hidden; :meth:`reveal` / :meth:`conceal` toggle it (the app drives
    those from the :class:`RevealPolicy` against live mouse position). Selecting a
    control updates the controller, which publishes the change to the app.
    """

    def __init__(
        self,
        *,
        controller: Optional[SettingsController] = None,
        parent: object = None,
        qt_modules=None,
    ) -> None:
        from translator_app.translate.interface import supported_pairs

        self.controller = controller or SettingsController()
        mods = qt_modules or _import_qt()
        self._qt = mods
        QtWidgets = mods.QtWidgets

        self.widget = QtWidgets.QWidget(parent)
        # Solid bar background: the controls window is a layered/translucent window,
        # and Windows lets clicks fall through its fully-transparent pixels -- so an
        # un-painted bar would only be clickable on the controls themselves. A solid
        # background makes the whole revealed strip opaque (clickable end-to-end) and
        # reads as a proper bar. WA_StyledBackground makes the stylesheet bg paint.
        self.widget.setAttribute(mods.QtCore.Qt.WidgetAttribute.WA_StyledBackground, True)
        self.widget.setStyleSheet("background-color: rgba(20,20,20,225); color: #FFFFFF;")
        layout = QtWidgets.QHBoxLayout(self.widget)

        # Language pair
        self._pairs = list(supported_pairs())
        self.language_combo = QtWidgets.QComboBox()
        for pair in self._pairs:
            self.language_combo.addItem(str(pair))
        self._select_current(self.language_combo, self._pairs, self.controller.state.language_pair)
        self.language_combo.currentIndexChanged.connect(self._on_language_changed)

        # Font size
        self.font_spin = QtWidgets.QSpinBox()
        self.font_spin.setRange(1, 200)
        self.font_spin.setValue(self.controller.state.font_size_pt)
        self.font_spin.valueChanged.connect(self.controller.set_font_size)

        # Position
        self._positions = list(SubtitlePosition)
        self.position_combo = QtWidgets.QComboBox()
        for position in self._positions:
            self.position_combo.addItem(position.value)
        self._select_current(self.position_combo, self._positions, self.controller.state.position)
        self.position_combo.currentIndexChanged.connect(self._on_position_changed)

        # Opacity (0..100 percent -> 0.0..1.0)
        self.opacity_spin = QtWidgets.QSpinBox()
        self.opacity_spin.setRange(0, 100)
        self.opacity_spin.setValue(int(round(self.controller.state.background_opacity * 100)))
        self.opacity_spin.valueChanged.connect(lambda pct: self.controller.set_opacity(pct / 100.0))

        # Model size (latency vs accuracy)
        self._models = ModelSize.ordered()
        self.model_combo = QtWidgets.QComboBox()
        for model_size in self._models:
            self.model_combo.addItem(model_size.value)
        self._select_current(self.model_combo, self._models, self.controller.state.model_size)
        self.model_combo.currentIndexChanged.connect(self._on_model_changed)

        # Exit
        self.exit_button = QtWidgets.QPushButton("Exit")
        self.exit_button.clicked.connect(self.controller.request_exit)

        for label, control in (
            ("Language", self.language_combo),
            ("Font", self.font_spin),
            ("Position", self.position_combo),
            ("Opacity %", self.opacity_spin),
            ("Model", self.model_combo),
        ):
            layout.addWidget(QtWidgets.QLabel(label))
            layout.addWidget(control)
        layout.addWidget(self.exit_button)

        self.is_revealed = False
        self.widget.hide()

    @staticmethod
    def _select_current(combo, items: list, current) -> None:
        if current in items:
            combo.setCurrentIndex(items.index(current))

    def _on_language_changed(self, index: int) -> None:
        if 0 <= index < len(self._pairs):
            self.controller.set_language_pair(self._pairs[index])

    def _on_position_changed(self, index: int) -> None:
        if 0 <= index < len(self._positions):
            self.controller.set_position(self._positions[index])

    def _on_model_changed(self, index: int) -> None:
        if 0 <= index < len(self._models):
            self.controller.set_model_size(self._models[index])

    def reveal(self) -> None:
        self.is_revealed = True
        self.widget.show()

    def conceal(self) -> None:
        self.is_revealed = False
        self.widget.hide()
