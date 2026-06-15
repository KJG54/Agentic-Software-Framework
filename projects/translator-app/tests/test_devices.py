"""Tests for audio device enumeration + the launch-time picker (TASK-1102).

The real audio backend (PyAudioWPatch / WASAPI) is mocked here: enumeration is
driven by a fake backend that yields canned device-info mappings, and the picker
is driven by injected input/output callables. Nothing needs to be installed.

    python -m unittest discover -s tests
"""

import os
import sys
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)


class FakeBackend:
    """Stands in for the PyAudioWPatch device list."""

    def __init__(self, infos):
        self._infos = infos

    def iter_devices(self):
        return iter(self._infos)


def _info(index, name, *, loopback, in_ch=2, rate=48000.0, host_api=0):
    return {
        "index": index,
        "name": name,
        "hostApi": host_api,
        "maxInputChannels": in_ch,
        "maxOutputChannels": 0 if loopback else 2,
        "defaultSampleRate": rate,
        "isLoopbackDevice": loopback,
    }


class EnumerateTest(unittest.TestCase):
    def test_filters_to_loopback_devices_only(self):
        from translator_app.audio.devices import enumerate_loopback_devices

        backend = FakeBackend([
            _info(0, "Speakers (Realtek)", loopback=False),
            _info(1, "Speakers (Realtek) [Loopback]", loopback=True),
            _info(2, "Microphone", loopback=False),
            _info(3, "Headphones [Loopback]", loopback=True),
        ])

        devices = enumerate_loopback_devices(backend)

        self.assertEqual([d.name for d in devices],
                         ["Headphones [Loopback]", "Speakers (Realtek) [Loopback]"])
        self.assertTrue(all(d.is_loopback for d in devices))

    def test_maps_backend_fields(self):
        from translator_app.audio.devices import enumerate_loopback_devices

        backend = FakeBackend([_info(7, "Speakers [Loopback]", loopback=True, in_ch=2, rate=44100.0)])
        device = enumerate_loopback_devices(backend)[0]

        self.assertEqual(device.index, 7)
        self.assertEqual(device.name, "Speakers [Loopback]")
        self.assertEqual(device.max_input_channels, 2)
        self.assertEqual(device.default_sample_rate, 44100.0)

    def test_id_is_stable_and_distinct(self):
        from translator_app.audio.devices import enumerate_loopback_devices

        backend = FakeBackend([
            _info(1, "Speakers [Loopback]", loopback=True),
            _info(2, "Headphones [Loopback]", loopback=True),
        ])
        first = {d.name: d.id for d in enumerate_loopback_devices(backend)}
        # Index changed (re-plug / reboot) but the identity should not.
        backend2 = FakeBackend([
            _info(9, "Speakers [Loopback]", loopback=True),
            _info(4, "Headphones [Loopback]", loopback=True),
        ])
        second = {d.name: d.id for d in enumerate_loopback_devices(backend2)}

        self.assertEqual(first, second)
        self.assertNotEqual(first["Speakers [Loopback]"], first["Headphones [Loopback]"])


class PickerTest(unittest.TestCase):
    def _devices(self):
        from translator_app.audio.devices import enumerate_loopback_devices
        return enumerate_loopback_devices(FakeBackend([
            _info(1, "Headphones [Loopback]", loopback=True),
            _info(2, "Speakers [Loopback]", loopback=True),
        ]))

    def test_returns_chosen_device(self):
        from translator_app.ui.device_picker import prompt_for_device

        chosen = prompt_for_device(self._devices(), input_fn=lambda _: "1", output_fn=lambda *_: None)
        self.assertEqual(chosen.name, "Speakers [Loopback]")

    def test_auto_selects_when_single_device(self):
        from translator_app.ui.device_picker import prompt_for_device

        only = self._devices()[:1]
        calls = []
        chosen = prompt_for_device(only, input_fn=lambda _: calls.append("asked") or "0", output_fn=lambda *_: None)
        self.assertEqual(chosen.name, "Headphones [Loopback]")
        self.assertEqual(calls, [], "should not prompt when there is only one device")

    def test_reprompts_on_invalid_input(self):
        from translator_app.ui.device_picker import prompt_for_device

        answers = iter(["nine", "99", "0"])
        chosen = prompt_for_device(self._devices(), input_fn=lambda _: next(answers), output_fn=lambda *_: None)
        self.assertEqual(chosen.name, "Headphones [Loopback]")

    def test_raises_when_no_devices(self):
        from translator_app.ui.device_picker import prompt_for_device, NoLoopbackDevicesError

        with self.assertRaises(NoLoopbackDevicesError):
            prompt_for_device([], input_fn=lambda _: "0", output_fn=lambda *_: None)


if __name__ == "__main__":
    unittest.main()
