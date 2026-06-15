"""Subtitle renderer for the overlay (TASK-1107).

Two pure pieces plus a thin Qt layer:

* :class:`SubtitleModel` -- the timing/clearing logic. It turns the partial and
  finalized segments produced by the ASR/translate pipeline into displayed
  lines: a *partial* replaces the live (still-changing) line in place, a *final*
  promotes it, and lines clear once they are older than ``hold_seconds`` against
  an injected clock. This is what gives captions the "reads in real time" feel.
* :class:`SubtitleStyle` -- the appearance model: font size, screen position,
  and background opacity, with clamping and pure mappings to Qt alignment names
  and a background CSS color.
* :class:`SubtitleRenderer` -- a ``QLabel`` that applies the style and shows the
  model's visible lines. PySide6 is lazy-imported and the Qt module injectable.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


@dataclass
class SubtitleLine:
    text: str
    is_final: bool
    updated_at: float


class SubtitleModel:
    """Accumulates partial/final segments into time-limited display lines."""

    def __init__(self, *, hold_seconds: float = 6.0, max_lines: int = 2) -> None:
        self.hold_seconds = hold_seconds
        self.max_lines = max_lines
        self._lines: List[SubtitleLine] = []

    def add_partial(self, text: str, *, now: float) -> None:
        """Set/replace the live (non-final) line in place."""
        if self._lines and not self._lines[-1].is_final:
            self._lines[-1].text = text
            self._lines[-1].updated_at = now
        else:
            self._append(SubtitleLine(text, False, now))

    def add_final(self, text: str, *, now: float) -> None:
        """Promote the live partial to a finalized line (or append a new one)."""
        if self._lines and not self._lines[-1].is_final:
            self._lines[-1].text = text
            self._lines[-1].is_final = True
            self._lines[-1].updated_at = now
        else:
            self._append(SubtitleLine(text, True, now))

    def ingest(self, segment: object, *, now: float) -> None:
        """Route a pipeline segment (``.text`` / ``.is_final``) to the right add."""
        if getattr(segment, "is_final", False):
            self.add_final(segment.text, now=now)
        else:
            self.add_partial(segment.text, now=now)

    def visible_lines(self, now: float) -> List[SubtitleLine]:
        """Lines not yet older than ``hold_seconds`` (also prunes them)."""
        self._lines = [ln for ln in self._lines if now - ln.updated_at <= self.hold_seconds]
        return list(self._lines)

    def _append(self, line: SubtitleLine) -> None:
        self._lines.append(line)
        if len(self._lines) > self.max_lines:
            self._lines = self._lines[-self.max_lines :]


class SubtitlePosition(Enum):
    TOP = "top"
    CENTER = "center"
    BOTTOM = "bottom"


@dataclass(frozen=True)
class SubtitleStyle:
    font_size_pt: int = 32
    position: SubtitlePosition = SubtitlePosition.BOTTOM
    background_opacity: float = 0.5
    text_color: str = "#FFFFFF"
    margin_px: int = 64

    def __post_init__(self) -> None:
        object.__setattr__(self, "font_size_pt", max(1, int(self.font_size_pt)))
        object.__setattr__(self, "background_opacity", min(1.0, max(0.0, float(self.background_opacity))))

    def background_css(self) -> str:
        alpha = int(round(self.background_opacity * 255))
        return f"rgba(0,0,0,{alpha})"


def alignment_flag_names(style: SubtitleStyle) -> List[str]:
    """Qt ``AlignmentFlag`` names for the chosen position (always H-centered)."""
    vertical = {
        SubtitlePosition.TOP: "AlignTop",
        SubtitlePosition.CENTER: "AlignVCenter",
        SubtitlePosition.BOTTOM: "AlignBottom",
    }[style.position]
    return ["AlignHCenter", vertical]


def _resolve(qt, name: str, enum_class: str):
    scope = getattr(qt, enum_class, None)
    if scope is not None and hasattr(scope, name):
        return getattr(scope, name)
    return getattr(qt, name)


def _import_qt():
    from PySide6 import QtCore, QtGui, QtWidgets  # noqa: PLC0415 (lazy: optional GUI dep)

    class _Modules:
        pass

    modules = _Modules()
    modules.QtCore = QtCore
    modules.QtGui = QtGui
    modules.QtWidgets = QtWidgets
    return modules


class SubtitleRenderer:
    """A ``QLabel`` that styles and displays the model's visible subtitle lines."""

    def __init__(
        self,
        *,
        model: Optional[SubtitleModel] = None,
        style: Optional[SubtitleStyle] = None,
        parent: object = None,
        qt_modules=None,
    ) -> None:
        self.model = model or SubtitleModel()
        self.style = style or SubtitleStyle()
        mods = qt_modules or _import_qt()
        self._qt = mods
        self.widget = mods.QtWidgets.QLabel(parent)
        self._apply_style()

    def _apply_style(self) -> None:
        QtCore, QtGui = self._qt.QtCore, self._qt.QtGui
        font = self.widget.font()
        font.setPointSize(self.style.font_size_pt)
        self.widget.setFont(font)
        self.widget.setWordWrap(True)

        alignment = None
        for name in alignment_flag_names(self.style):
            flag = _resolve(QtCore.Qt, name, "AlignmentFlag")
            alignment = flag if alignment is None else alignment | flag
        if alignment is not None:
            self.widget.setAlignment(alignment)

        self.widget.setStyleSheet(
            f"color: {self.style.text_color};"
            f" background-color: {self.style.background_css()};"
            f" padding: 8px; margin: {self.style.margin_px}px;"
        )

    def ingest(self, segment: object, *, now: float) -> None:
        self.model.ingest(segment, now=now)

    def update_display(self, now: float) -> str:
        text = "\n".join(line.text for line in self.model.visible_lines(now))
        self.widget.setText(text)
        return text
