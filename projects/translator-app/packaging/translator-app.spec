# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build spec for translator-app (TASK-1111).

Build (from the project root, on Windows, in the configured venv):

    pyinstaller packaging/translator-app.spec

Produces a single windowed executable at ``dist/translator-app.exe``.

Model / runtime bundling strategy
---------------------------------
The Whisper *weights* are deliberately NOT bundled into the exe. faster-whisper
downloads the selected model (tiny..large-v3) from Hugging Face on first use and
caches it under ``%USERPROFILE%\\.cache\\huggingface``; that keeps the exe small
and lets the latency/accuracy model switch pull other sizes on demand. What IS
bundled is the Python runtime and the code dependencies (PySide6, numpy,
ctranslate2/faster-whisper, PyAudioWPatch) via ``hiddenimports`` below. CUDA is
expected to be present on the host GPU, not shipped in the exe.
"""

import os

# SPECPATH is injected by PyInstaller (the directory containing this .spec).
SRC = os.path.join(SPECPATH, "..", "src")

block_cipher = None

a = Analysis(
    [os.path.join(SPECPATH, "entry.py")],
    pathex=[SRC],
    binaries=[],
    datas=[],
    hiddenimports=[
        "translator_app",
        "translator_app.launcher",
        "PySide6.QtCore",
        "PySide6.QtGui",
        "PySide6.QtWidgets",
        "faster_whisper",
        "ctranslate2",
        "pyaudiowpatch",
        "numpy",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles if hasattr(a, "zipfiles") else [],
    a.datas,
    [],
    name="translator-app",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # windowed: an overlay app, no console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
