"""Smoke test for the translator-app skeleton (TASK-1101).

Verifies the package imports and the entry point is callable without pulling in
any of the heavy runtime dependencies (faster-whisper, audio backend, GUI).
Runs under stdlib unittest so it needs nothing installed:

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

# Make the src/ layout importable without an install step.
SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


class SmokeTest(unittest.TestCase):
    def test_package_imports_and_exposes_version(self):
        import translator_app

        self.assertTrue(translator_app.__version__)
        self.assertIsInstance(translator_app.__version__, str)

    def test_entry_point_is_callable_and_returns_zero(self):
        from translator_app.__main__ import main

        self.assertTrue(callable(main))
        # Skeleton entry point must run headlessly and signal success.
        self.assertEqual(main([]), 0)


if __name__ == "__main__":
    unittest.main()
