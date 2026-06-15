"""PyInstaller entry script for the packaged Windows executable (TASK-1111).

The frozen ``.exe`` runs this module. It just enters the normal app entry point
with ``--launch`` so the packaged build and ``python -m translator_app --launch``
take exactly the same code path.
"""

from translator_app.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main(["--launch"]))
