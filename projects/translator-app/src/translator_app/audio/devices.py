"""Enumerate WASAPI loopback-capable audio devices (TASK-1102).

The enumeration/mapping logic is backend-agnostic: it consumes raw device-info
mappings (the shape PyAudioWPatch returns from ``get_device_info_by_index``) via
an ``AudioBackend`` and produces clean :class:`AudioDevice` records. This keeps
the logic unit-testable with a fake backend, and keeps the heavy PyAudioWPatch
import out of module import (it is loaded lazily inside the real backend).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Iterable, List, Mapping, Protocol


@dataclass(frozen=True)
class AudioDevice:
    """A loopback-capable audio device the app can listen to.

    ``id`` is derived from stable attributes (name + host API) rather than the
    backend index, which can change across reboots or re-plugging. ``index`` is
    still carried because the backend needs it to actually open the stream.
    """

    id: str
    index: int
    name: str
    host_api: str
    max_input_channels: int
    default_sample_rate: float
    is_loopback: bool


class AudioBackend(Protocol):
    def iter_devices(self) -> Iterable[Mapping[str, object]]:
        """Yield raw device-info mappings for every device the host exposes."""


def _get(info: Mapping[str, object], *keys, default=None):
    for key in keys:
        if key in info:
            return info[key]
    return default


def _stable_id(name: str, host_api: str) -> str:
    raw = f"{host_api}::{name}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:12]


def _to_device(info: Mapping[str, object]) -> AudioDevice:
    name = str(_get(info, "name", default="")).strip()
    host_api = str(_get(info, "hostApi", "host_api", default=""))
    return AudioDevice(
        id=_stable_id(name, host_api),
        index=int(_get(info, "index", default=-1)),
        name=name,
        host_api=host_api,
        max_input_channels=int(_get(info, "maxInputChannels", "max_input_channels", default=0)),
        default_sample_rate=float(_get(info, "defaultSampleRate", "default_sample_rate", default=0.0)),
        is_loopback=bool(_get(info, "isLoopbackDevice", "is_loopback", default=False)),
    )


def enumerate_loopback_devices(backend: AudioBackend) -> List[AudioDevice]:
    """Return loopback-capable devices, sorted by name for a stable picker order."""
    devices = (_to_device(info) for info in backend.iter_devices())
    loopback = [device for device in devices if device.is_loopback]
    loopback.sort(key=lambda device: device.name.lower())
    return loopback


class PyAudioWPatchBackend:
    """Real backend backed by PyAudioWPatch. Imports the dependency lazily.

    On Windows, PyAudioWPatch exposes WASAPI loopback devices in the normal
    device list with ``isLoopbackDevice`` set, so iterating every device and
    filtering in :func:`enumerate_loopback_devices` is sufficient.
    """

    def __init__(self) -> None:
        import pyaudiowpatch as pyaudio  # noqa: PLC0415 (lazy: heavy, Windows-only)

        self._pyaudio = pyaudio
        self._pa = pyaudio.PyAudio()

    def iter_devices(self) -> Iterable[Mapping[str, object]]:
        for index in range(self._pa.get_device_count()):
            yield self._pa.get_device_info_by_index(index)

    def close(self) -> None:
        self._pa.terminate()
