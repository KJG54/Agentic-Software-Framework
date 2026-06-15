"""Exit controls for the overlay (TASK-1109).

Two routes out of the running app, both reaching one handler (typically
``Application.shutdown`` followed by quitting the Qt loop):

* the settings bar's Exit (its :class:`~translator_app.ui.settings_bar.SettingsController`
  exit channel -- see :func:`bind_exit_routes`), and
* :class:`ExitButton`, a small always-visible button pinned to the top-right
  corner, for when the settings bar is hidden.

The button is a thin PySide6 widget (lazy-imported, injectable); the route
binding is pure.
"""

from __future__ import annotations

from typing import Callable, Optional


def _import_qt():
    from PySide6 import QtCore, QtWidgets  # noqa: PLC0415 (lazy: optional GUI dep)

    class _Modules:
        pass

    modules = _Modules()
    modules.QtCore = QtCore
    modules.QtWidgets = QtWidgets
    return modules


class ExitButton:
    """A small top-right button that calls ``on_exit`` when clicked."""

    def __init__(
        self,
        *,
        on_exit: Callable[[], None],
        parent: object = None,
        qt_modules=None,
        label: str = "×",  # multiplication sign, reads as a close "x"
        size: int = 32,
    ) -> None:
        mods = qt_modules or _import_qt()
        self._qt = mods
        self._on_exit = on_exit
        self.widget = mods.QtWidgets.QPushButton(label, parent)
        self.widget.setFixedSize(size, size)
        self.widget.clicked.connect(on_exit)

    def position_top_right(self, screen_width: int, *, margin: int = 8) -> None:
        """Pin the button to the top-right of a ``screen_width``-wide screen."""
        self.widget.move(screen_width - self.widget.width() - margin, margin)


def bind_exit_routes(settings_controller, on_exit: Callable[[], None], *, exit_button: Optional[ExitButton] = None) -> Callable[[], None]:
    """Wire every exit route to a single ``on_exit`` handler.

    Subscribes the settings bar's exit channel; if an :class:`ExitButton` is
    passed it is (re)wired too, so callers can bind both routes in one place.
    The :class:`ExitButton` constructor already connects its click, so passing
    one here is optional. Returns ``on_exit`` for convenience.
    """
    settings_controller.subscribe_exit(on_exit)
    if exit_button is not None:
        exit_button.widget.clicked.connect(on_exit)
    return on_exit
