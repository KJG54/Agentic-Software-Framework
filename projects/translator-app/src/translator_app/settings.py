"""Ephemeral settings and latency-accuracy wiring (TASK-1110).

Two responsibilities:

Ephemeral settings
------------------
The app intentionally has **no persistence**. :func:`default_settings` returns a
fresh :class:`~translator_app.ui.settings_bar.SettingsState` -- the documented
defaults -- on every call, so every launch starts identical regardless of what a
previous run did. There is deliberately no load/save API.

Latency-accuracy wiring
-----------------------
The model-size control is the latency-vs-accuracy lever (``tiny`` is fast/rough,
``large-v3`` is slow/accurate). :class:`PipelineReconfigurator` listens to the
settings controller and, when the model size (or language pair) changes, rebuilds
the ASR transcriber and a fresh :class:`~translator_app.asr.whisper_pipeline.
WhisperPipeline`, handing the new pipeline to a sink -- typically
``AsrWorker.set_pipeline`` -- so the change takes effect on the live stream.

The real builders use :func:`~translator_app.translate.interface.create_translator`
and lazy-import faster-whisper only when a real model is constructed; the wiring
itself is pure and injectable, so it tests with nothing installed.
"""

from __future__ import annotations

from typing import Callable

from .asr.whisper_pipeline import WhisperPipeline
from .translate.interface import LanguagePair, create_translator
from .ui.settings_bar import ModelSize, SettingsChange, SettingsController, SettingsState

DEFAULT_LANGUAGE_PAIR = LanguagePair("ja", "en")


def default_settings() -> SettingsState:
    """The settings a launch starts from. Fresh and pristine every call.

    Nothing is read from disk or a previous session, so this is the whole of the
    app's "load settings" behaviour: always the defaults.
    """
    return SettingsState()


def build_default_transcriber(
    model_size: ModelSize,
    language_pair: LanguagePair,
    *,
    create: Callable[..., object] = create_translator,
):
    """Build the translate/ASR backend for ``language_pair`` at ``model_size``.

    ``create`` is injectable for testing; by default it is
    :func:`create_translator`, which selects the registered backend for the pair
    and forwards ``model_size`` to it (faster-whisper is loaded lazily there).
    """
    return create(language_pair, model_size=model_size.value)


def default_pipeline_factory(
    *, input_rate: int, input_channels: int, **pipeline_options
) -> Callable[[object], WhisperPipeline]:
    """Return a ``transcriber -> WhisperPipeline`` factory bound to the capture format."""

    def make(transcriber) -> WhisperPipeline:
        return WhisperPipeline(
            transcriber,
            input_rate=input_rate,
            input_channels=input_channels,
            **pipeline_options,
        )

    return make


class PipelineReconfigurator:
    """Rebuilds the ASR pipeline when the latency/accuracy choice changes.

    Subscribes to ``controller`` and, on a ``model_size`` or ``language_pair``
    change, builds a new transcriber and pipeline and pushes it to ``on_pipeline``
    (e.g. ``AsrWorker.set_pipeline``). Call :meth:`rebuild` once at startup to
    build the initial pipeline from the current settings.
    """

    _REBUILD_FIELDS = frozenset({"model_size", "language_pair"})

    def __init__(
        self,
        controller: SettingsController,
        *,
        build_transcriber: Callable[[ModelSize, LanguagePair], object],
        make_pipeline: Callable[[object], object],
        on_pipeline: Callable[[object], None],
    ) -> None:
        self._controller = controller
        self._build_transcriber = build_transcriber
        self._make_pipeline = make_pipeline
        self._on_pipeline = on_pipeline
        self.pipeline = None
        controller.subscribe(self._on_change)

    def _on_change(self, change: SettingsChange) -> None:
        if change.field in self._REBUILD_FIELDS:
            self.rebuild()

    def rebuild(self):
        """Build a transcriber + pipeline from the current settings and publish it."""
        state = self._controller.state
        transcriber = self._build_transcriber(state.model_size, state.language_pair)
        self.pipeline = self._make_pipeline(transcriber)
        self._on_pipeline(self.pipeline)
        return self.pipeline
