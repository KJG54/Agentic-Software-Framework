"""Tests for the Windows packaging configuration (TASK-1111).

PyInstaller isn't installed here (and a real build takes minutes), so instead of
running it we *execute the .spec file* with fake PyInstaller globals
(``Analysis``/``PYZ``/``EXE``) injected and assert on the arguments it records.
This catches the things that actually break a build -- wrong entry script,
missing the ``src`` path, missing hidden imports, or a console window on a
windowed overlay app -- without needing PyInstaller. We also check the entry
script and that the README documents setup, running, and model bundling.

    python -m unittest discover -s tests
"""

import os
import unittest

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGING = os.path.join(PROJECT, "packaging")
SPEC = os.path.join(PACKAGING, "translator-app.spec")
ENTRY = os.path.join(PACKAGING, "entry.py")
README = os.path.join(PROJECT, "README.md")


class _FakeAnalysis:
    last = None

    def __init__(self, scripts, *args, **kwargs):
        self.scripts = scripts
        self.args = args
        self.kwargs = kwargs
        # attributes the spec references when wiring PYZ/EXE
        self.pure = "pure"
        self.zipped_data = "zipped_data"
        self.binaries = "binaries"
        self.datas = "datas"
        _FakeAnalysis.last = self


class _FakePYZ:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class _FakeEXE:
    last = None

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        _FakeEXE.last = self


def _exec_spec():
    _FakeAnalysis.last = None
    _FakeEXE.last = None
    with open(SPEC, "r", encoding="utf-8") as handle:
        source = handle.read()
    namespace = {
        "Analysis": _FakeAnalysis,
        "PYZ": _FakePYZ,
        "EXE": _FakeEXE,
        "SPECPATH": PACKAGING,
        "__file__": SPEC,
    }
    code = compile(source, SPEC, "exec")
    exec(code, namespace)  # noqa: S102 - executing our own checked-in spec under test
    return _FakeAnalysis.last, _FakeEXE.last


class PackagingFilesExistTest(unittest.TestCase):
    def test_spec_and_entry_and_readme_exist(self):
        self.assertTrue(os.path.isfile(SPEC), "PyInstaller spec must exist")
        self.assertTrue(os.path.isfile(ENTRY), "entry script must exist")
        self.assertTrue(os.path.isfile(README), "README must exist")


class SpecConfigTest(unittest.TestCase):
    def test_spec_executes_and_targets_the_entry_script(self):
        analysis, _exe = _exec_spec()
        self.assertIsNotNone(analysis, "spec must call Analysis(...)")
        scripts = analysis.scripts
        self.assertTrue(any(str(s).endswith("entry.py") for s in scripts), "Analysis must build the entry script")

    def test_src_is_on_the_import_path(self):
        analysis, _exe = _exec_spec()
        pathex = analysis.kwargs.get("pathex", [])
        self.assertTrue(any(str(p).endswith("src") for p in pathex), "pathex must include the src/ layout")

    def test_heavy_runtime_deps_are_hidden_imports(self):
        analysis, _exe = _exec_spec()
        hidden = set(analysis.kwargs.get("hiddenimports", []))
        for dep in ("faster_whisper", "pyaudiowpatch", "numpy"):
            self.assertIn(dep, hidden, f"{dep} must be a hidden import for the build to run")
        self.assertTrue(any(h.startswith("PySide6") for h in hidden), "PySide6 must be bundled")

    def test_builds_a_named_windowed_executable(self):
        _analysis, exe = _exec_spec()
        self.assertIsNotNone(exe, "spec must call EXE(...)")
        self.assertEqual(exe.kwargs.get("name"), "translator-app")
        self.assertIs(exe.kwargs.get("console"), False, "overlay app must be windowed (no console)")

    def test_bundles_cuda_runtime_dlls(self):
        # Source-based (not result-based) so it holds regardless of whether the
        # nvidia-*-cu12 wheels are installed in the build env: the spec must wire
        # up CUDA-runtime collection and feed it to Analysis(binaries=...).
        with open(SPEC, "r", encoding="utf-8") as handle:
            src = handle.read()
        self.assertIn("collect_dynamic_libs", src, "spec must collect the CUDA runtime DLLs")
        for pkg in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_runtime"):
            self.assertIn(pkg, src, f"spec must bundle {pkg}")
        # And the collected list must be wired into Analysis (not the old binaries=[]).
        self.assertIn("binaries=cuda_binaries", src, "binaries must use the collected CUDA libs")


class EntryScriptTest(unittest.TestCase):
    def test_entry_launches_the_app(self):
        with open(ENTRY, "r", encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn("translator_app", text)
        self.assertIn("--launch", text, "entry script must invoke the real launch path")


class ReadmeTest(unittest.TestCase):
    def _readme(self):
        with open(README, "r", encoding="utf-8") as handle:
            return handle.read().lower()

    def test_documents_setup_run_and_bundling(self):
        text = self._readme()
        self.assertIn("setup", text)
        self.assertIn("pip install", text)
        self.assertIn("pyinstaller", text)
        self.assertIn("run", text)
        # the model/runtime bundling strategy must be explained
        self.assertIn("model", text)
        self.assertTrue(
            any(word in text for word in ("bundl", "download", "cache")),
            "README must explain how the model/runtime is bundled or fetched",
        )


if __name__ == "__main__":
    unittest.main()
