"""Japanese->English translation backend via faster-whisper (TASK-1105).

Uses Whisper's ``translate`` task, which takes Japanese audio and emits English
text directly. Implements the streaming :class:`~translator_app.translate.
interface.Translator` contract, so it can be fed straight into
:class:`~translator_app.asr.whisper_pipeline.WhisperPipeline` to stream English
subtitles. faster-whisper is lazy-imported (and the model is injectable) so this
module loads and tests without it.

Device selection (auto + GPU-probe + CPU fallback)
--------------------------------------------------
The default ``device="auto"`` makes the app *just run* anywhere. A hardcoded
``device="cuda"`` was the original "no subtitles" bug: faster-whisper loads the
GPU model fine, but its CUDA runtime (cuBLAS/cuDNN) is loaded *lazily at the
first inference*, so a host without those DLLs raised deep on the ASR worker
thread -- silently, because the windowed build has no console. So:

* ``_prepare_cuda_libs`` surfaces the pip ``nvidia-*-cu12`` DLLs on ``PATH``
  before ctranslate2 loads (Windows finds the lazy cuBLAS only via ``PATH``,
  not ``os.add_dll_directory`` alone).
* :func:`load_whisper_model` resolves ``auto`` to ``cuda`` only when a CUDA
  device exists, then *probes* a tiny inference; if that raises (GPU present but
  unusable) it transparently rebuilds on CPU. GPU is ~35x realtime here, CPU
  ~2x -- both keep up, GPU just far more comfortably.

The selection helpers take injectable seams (``build``/``probe``/
``cuda_available``) so the whole policy is unit-tested with nothing installed.
"""

from __future__ import annotations

import os
import sys
from typing import Callable, List, Optional, Tuple

from .interface import LanguagePair, Translator, register_translator

JA_EN = LanguagePair("ja", "en")


def _prepare_cuda_libs() -> None:
    """Best-effort: put pip-installed NVIDIA CUDA runtime DLLs on the search path.

    The ``nvidia-cublas-cu12`` / ``nvidia-cudnn-cu12`` / ``nvidia-cuda-runtime-cu12``
    wheels drop their DLLs under ``site-packages/nvidia/*/bin``. ctranslate2 loads
    cuBLAS lazily and, on Windows, finds it only via ``PATH``; prepend those dirs
    before the first model build. No-op when the packages aren't installed; frozen
    builds that bundle the DLLs put them beside the executable / in ``_MEIPASS``,
    which is already on the load path. Never raises.
    """
    import importlib.util  # noqa: PLC0415

    dirs: List[str] = []
    # Frozen build: the spec bundles the CUDA DLLs beside the executable. In a
    # PyInstaller onefile that unpack dir is ``sys._MEIPASS``; surface it so the
    # lazy cuBLAS load finds them (PyInstaller doesn't add it to PATH itself).
    frozen_base = getattr(sys, "_MEIPASS", None)
    if frozen_base and os.path.isdir(frozen_base):
        dirs.append(frozen_base)
    for mod in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_runtime"):
        try:
            spec = importlib.util.find_spec(mod)
        except Exception:  # noqa: BLE001 - missing/abnormal package must not break startup
            spec = None
        if not spec or not spec.submodule_search_locations:
            continue
        for loc in spec.submodule_search_locations:
            for root, _subdirs, files in os.walk(loc):
                if any(f.lower().endswith(".dll") for f in files):
                    dirs.append(root)
    if dirs:
        os.environ["PATH"] = os.pathsep.join(dirs) + os.pathsep + os.environ.get("PATH", "")
        for directory in dirs:
            try:
                os.add_dll_directory(directory)  # type: ignore[attr-defined]
            except (OSError, AttributeError):
                pass


def _cuda_is_available() -> bool:
    """True when ctranslate2 reports at least one CUDA device. Never raises."""
    try:
        import ctranslate2  # noqa: PLC0415 (lazy: heavy dep)

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001 - any failure means "no usable CUDA"
        return False


def _resolve_device(requested: str, *, cuda_available: bool) -> str:
    """Map ``"auto"`` to ``cuda``/``cpu`` by availability; honor explicit choices."""
    if requested == "auto":
        return "cuda" if cuda_available else "cpu"
    return requested


def _compute_type_for(device: str, requested: Optional[str]) -> str:
    """Pick a sensible ctranslate2 compute type for ``device`` if none was given."""
    if requested is not None:
        return requested
    return "float16" if device == "cuda" else "int8"


def _default_build(model_size: str, device: str, compute_type: str):
    _prepare_cuda_libs()
    from faster_whisper import WhisperModel  # noqa: PLC0415 (lazy: heavy GPU dep)

    return WhisperModel(model_size, device=device, compute_type=compute_type)


def _probe_inference(model) -> None:
    """Run a tiny inference so a lazily-loaded-but-broken CUDA stack fails *here*.

    ctranslate2 doesn't touch cuBLAS until the first ``encode``; without this
    probe a missing CUDA runtime would instead crash the ASR worker thread mid-
    stream. 0.1s of silence is enough to force the encode path.
    """
    import numpy as np  # noqa: PLC0415 (lazy: heavy dep)

    segments, _info = model.transcribe(
        np.zeros(1600, dtype=np.float32), language="ja", task="translate", beam_size=1
    )
    list(segments)


def load_whisper_model(
    model_size: str,
    device: str,
    compute_type: Optional[str],
    *,
    build: Optional[Callable[[str, str, str], object]] = None,
    probe: Optional[Callable[[object], None]] = None,
    cuda_available: Optional[bool] = None,
):
    """Build a faster-whisper model, preferring a *working* GPU, else CPU.

    Resolves ``device`` (``"auto"`` follows CUDA availability), builds on CUDA and
    probes a tiny inference; if the GPU is present but its CUDA runtime can't run
    (the classic missing-cuBLAS case) it rebuilds on CPU. ``build``/``probe``/
    ``cuda_available`` are injectable so the policy tests without faster-whisper.
    """
    build = build or _default_build
    probe = probe or _probe_inference
    if cuda_available is None:
        cuda_available = _cuda_is_available()

    device = _resolve_device(device, cuda_available=cuda_available)
    if device == "cuda":
        try:
            model = build(model_size, "cuda", _compute_type_for("cuda", compute_type))
            probe(model)
            return model
        except Exception:  # noqa: BLE001 - GPU unusable; fall back rather than crash later
            device = "cpu"
    return build(model_size, "cpu", _compute_type_for("cpu", compute_type))


class WhisperJaEnTranslator:
    """Translate Japanese audio to English segments with Whisper's translate task.

    ``model_size`` is the latency/accuracy lever shared with the ASR pipeline and
    wired to the UI by TASK-1110. ``device`` defaults to ``"auto"`` (use a working
    GPU if present, else CPU -- see module docstring). Pass ``model=`` to inject a
    pre-built model (used in tests); otherwise faster-whisper is loaded here.
    """

    def __init__(
        self,
        model_size: str = "small",
        *,
        device: str = "auto",
        compute_type: Optional[str] = None,
        beam_size: int = 1,
        model: Optional[object] = None,
    ) -> None:
        self.pair = JA_EN
        if model is None:
            model = load_whisper_model(model_size, device, compute_type)
        self._model = model
        self._beam_size = beam_size

    def transcribe(self, audio: object, sample_rate: int) -> List[Tuple[float, float, str]]:
        segments, _info = self._model.transcribe(
            audio,
            language="ja",
            task="translate",
            beam_size=self._beam_size,
        )
        return [(s.start, s.end, s.text) for s in segments]


def _factory(**options: object) -> Translator:
    return WhisperJaEnTranslator(**options)


register_translator(JA_EN, _factory)
