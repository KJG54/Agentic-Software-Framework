"""Entry point for translator-app (``python -m translator_app``).

The skeleton entry point is intentionally dependency-free: it must import and
run without faster-whisper, an audio backend, or a GUI toolkit installed, so
the smoke test can exercise it in any environment. Later tasks replace the body
with the real launch flow (device picker -> capture -> ASR -> translate ->
overlay).
"""

import sys
from typing import Optional, Sequence

from . import __version__


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Run the application entry point.

    Returns a process exit code (0 on success). The skeleton supports a single
    ``--version`` flag and otherwise prints a banner; it does not yet launch the
    overlay.
    """
    args = list(sys.argv[1:] if argv is None else argv)

    if "--version" in args:
        print(f"translator-app {__version__}")
        return 0

    print(f"translator-app {__version__} (skeleton)")
    print("The overlay is not wired up yet; see the task plan for remaining work.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
