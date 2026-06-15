"""Tests for exit controls and clean shutdown (TASK-1109).

The shutdown orchestration (Application) and the ASR worker thread are pure
(stdlib threading/queue) and tested directly, including that threads actually
terminate so there are no leaks or hangs. The exit controls (top-right button +
route binding) are verified with a real PySide6 offscreen smoke test, skipped if
PySide6 is unavailable.

    python -m unittest discover -s tests
"""

import os
import queue
import sys
import threading
import time
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


def wait_until(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


class FakePipeline:
    def __init__(self):
        self.fed = []
        self._lock = threading.Lock()

    def feed(self, chunk):
        with self._lock:
            self.fed.append(chunk)
        return [("segment", chunk)]


class FakeStoppable:
    """A component with start()/stop() that records calls into a shared log."""

    def __init__(self, name, log, *, fail=False):
        self.name = name
        self._log = log
        self.fail = fail
        self.started = 0
        self.stopped = 0

    def start(self):
        self.started += 1
        self._log.append(("start", self.name))

    def stop(self):
        self.stopped += 1
        self._log.append(("stop", self.name))
        if self.fail:
            raise RuntimeError(f"{self.name} failed to stop")


class FakeOverlay:
    def __init__(self, log):
        self._log = log
        self.closed = 0

    def close(self):
        self.closed += 1
        self._log.append(("stop", "overlay"))


class AsrWorkerTest(unittest.TestCase):
    def test_drains_frames_into_pipeline_and_emits_segments(self):
        from translator_app.app import AsrWorker

        frames = queue.Queue()
        pipeline = FakePipeline()
        seen = []
        worker = AsrWorker(frames, pipeline, on_segment=seen.append, poll_timeout=0.02)

        worker.start()
        frames.put(b"a")
        frames.put(b"b")

        self.assertTrue(wait_until(lambda: len(pipeline.fed) == 2), "frames must reach the pipeline")
        self.assertTrue(wait_until(lambda: len(seen) == 2), "segments must be emitted")
        worker.stop()
        self.assertFalse(worker.is_running(), "thread must terminate on stop")

    def test_stop_is_safe_when_never_started(self):
        from translator_app.app import AsrWorker

        worker = AsrWorker(queue.Queue(), FakePipeline())
        worker.stop()  # must not raise or hang
        self.assertFalse(worker.is_running())

    def test_double_start_raises(self):
        from translator_app.app import AsrWorker

        worker = AsrWorker(queue.Queue(), FakePipeline(), poll_timeout=0.02)
        worker.start()
        try:
            with self.assertRaises(RuntimeError):
                worker.start()
        finally:
            worker.stop()


class ApplicationShutdownTest(unittest.TestCase):
    def test_start_then_shutdown_stops_components_in_reverse_order(self):
        from translator_app.app import Application

        log = []
        capture = FakeStoppable("capture", log)
        worker = FakeStoppable("asr_worker", log)
        overlay = FakeOverlay(log)
        app = Application(capture=capture, asr_worker=worker, overlay=overlay)

        app.start()
        self.assertEqual([e for e in log if e[0] == "start"], [("start", "capture"), ("start", "asr_worker")])

        errors = app.shutdown()
        self.assertEqual(errors, [])
        stops = [name for action, name in log if action == "stop"]
        # reverse of start: worker before capture; overlay closed too
        self.assertLess(stops.index("asr_worker"), stops.index("capture"))
        self.assertIn("overlay", stops)

    def test_shutdown_is_idempotent(self):
        from translator_app.app import Application

        log = []
        capture = FakeStoppable("capture", log)
        app = Application(capture=capture)
        app.shutdown()
        app.shutdown()
        self.assertEqual(capture.stopped, 1, "components must be stopped exactly once")
        self.assertTrue(app.is_shut_down)

    def test_shutdown_is_best_effort_and_collects_errors(self):
        from translator_app.app import Application

        log = []
        bad = FakeStoppable("asr_worker", log, fail=True)
        capture = FakeStoppable("capture", log)
        app = Application(capture=capture, asr_worker=bad)

        errors = app.shutdown()
        # the failure is recorded but the rest still tears down
        self.assertEqual([name for name, _exc in errors], ["asr_worker"])
        self.assertEqual(capture.stopped, 1, "capture must still stop after a failing component")

    def test_shutdown_actually_terminates_real_threads(self):
        from translator_app.app import Application, AsrWorker

        frames = queue.Queue()
        capture_thread_done = threading.Event()

        class RealishCapture:
            """Spins a daemon thread like LoopbackCapture and joins on stop."""

            def __init__(self):
                self._stop = threading.Event()
                self._t = None

            def start(self):
                self._t = threading.Thread(target=self._run, daemon=True)
                self._t.start()

            def _run(self):
                while not self._stop.is_set():
                    time.sleep(0.005)
                capture_thread_done.set()

            def stop(self):
                self._stop.set()
                if self._t is not None:
                    self._t.join(2.0)

        worker = AsrWorker(frames, FakePipeline(), poll_timeout=0.02)
        capture = RealishCapture()
        app = Application(capture=capture, asr_worker=worker)
        app.start()

        app.shutdown()
        self.assertTrue(capture_thread_done.wait(2.0), "capture thread must exit")
        self.assertFalse(worker.is_running(), "asr worker thread must exit (no hang/leak)")


class ExitControlsQtTest(unittest.TestCase):
    def _qt(self):
        try:
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
            from PySide6 import QtWidgets
        except ImportError:
            self.skipTest("PySide6 not installed")
        return QtWidgets

    def test_top_right_button_click_invokes_handler(self):
        QtWidgets = self._qt()
        from translator_app.ui.exit_controls import ExitButton

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        calls = []
        button = ExitButton(on_exit=lambda: calls.append(True))
        button.widget.click()
        self.assertEqual(calls, [True])
        button.widget.deleteLater()
        del app

    def test_position_top_right_moves_button_to_corner(self):
        QtWidgets = self._qt()
        from translator_app.ui.exit_controls import ExitButton

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        button = ExitButton(on_exit=lambda: None, size=32)
        button.position_top_right(1920, margin=8)
        self.assertEqual(button.widget.x(), 1920 - 32 - 8)
        self.assertEqual(button.widget.y(), 8)
        button.widget.deleteLater()
        del app

    def test_both_routes_reach_one_handler(self):
        QtWidgets = self._qt()
        from translator_app.ui.exit_controls import ExitButton, bind_exit_routes
        from translator_app.ui.settings_bar import SettingsController

        app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
        calls = []

        def on_exit():
            calls.append(True)

        controller = SettingsController()
        button = ExitButton(on_exit=on_exit)
        bind_exit_routes(controller, on_exit)

        controller.request_exit()  # settings-bar route
        button.widget.click()       # top-right button route
        self.assertEqual(len(calls), 2)

        button.widget.deleteLater()
        del app


if __name__ == "__main__":
    unittest.main()
