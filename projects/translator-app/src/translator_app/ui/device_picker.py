"""Launch-time audio device picker (TASK-1102).

A dependency-free console picker: it lists the loopback-capable devices and
returns the one the user chooses. Input/output are injectable so the selection
logic is unit-testable without a real terminal (and so a GUI dialog from the
later UI tasks can reuse the same selection contract). A single available device
is auto-selected without prompting.
"""

from __future__ import annotations

from typing import Callable, Sequence

from ..audio.devices import AudioDevice


class NoLoopbackDevicesError(RuntimeError):
    """Raised when there are no loopback-capable devices to listen to."""


def prompt_for_device(
    devices: Sequence[AudioDevice],
    *,
    input_fn: Callable[[str], str] = input,
    output_fn: Callable[..., None] = print,
) -> AudioDevice:
    """Ask the user which device to listen from and return it.

    Raises :class:`NoLoopbackDevicesError` when ``devices`` is empty. Auto-selects
    when exactly one device is available. Otherwise lists the devices and reprompts
    until a valid index is entered.
    """
    if not devices:
        raise NoLoopbackDevicesError(
            "No loopback-capable audio devices were found. "
            "On Windows, enable a WASAPI output device and try again."
        )

    if len(devices) == 1:
        return devices[0]

    output_fn("Select the audio device to listen from:")
    for index, device in enumerate(devices):
        output_fn(
            f"  [{index}] {device.name} "
            f"({device.max_input_channels}ch @ {int(device.default_sample_rate)}Hz)"
        )

    while True:
        raw = input_fn("Device number: ").strip()
        try:
            choice = int(raw)
        except ValueError:
            output_fn(f"'{raw}' is not a number. Enter a value between 0 and {len(devices) - 1}.")
            continue
        if 0 <= choice < len(devices):
            return devices[choice]
        output_fn(f"Out of range. Enter a value between 0 and {len(devices) - 1}.")
