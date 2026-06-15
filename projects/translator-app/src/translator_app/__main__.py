"""Entry point for translator-app (``python -m translator_app``).

Without arguments this stays intentionally dependency-free -- it imports and
runs without faster-whisper, an audio backend, or a GUI toolkit, so the smoke
test can exercise it anywhere. Pass ``--launch`` to start the real overlay
(device pick -> capture -> ASR -> translate -> overlay); that path lazily
imports the heavy dependencies in :func:`translator_app.launcher.run`. The
packaged ``.exe`` enters here with ``--launch`` (see ``packaging/entry.py``).
"""

import sys
from typing import Optional, Sequence

from . import __version__


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Run the application entry point.

    Returns a process exit code (0 on success). ``--version`` prints the version;
    ``--launch`` starts the overlay app; otherwise a headless banner is printed.
    """
    args = list(sys.argv[1:] if argv is None else argv)

    if "--version" in args:
        print(f"translator-app {__version__}")
        return 0

    if "--launch" in args:
        from .launcher import run  # noqa: PLC0415 (lazy: pulls in GUI + ML deps)

        return run()

    print(f"translator-app {__version__}")
    print("Run with --launch to start the overlay; --version for the version.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
