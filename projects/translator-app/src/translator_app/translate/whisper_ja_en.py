"""Japanese->English translation backend via faster-whisper (TASK-1105).

Uses Whisper's ``translate`` task, which takes Japanese audio and emits English
text directly. Implements the streaming :class:`~translator_app.translate.
interface.Translator` contract, so it can be fed straight into
:class:`~translator_app.asr.whisper_pipeline.WhisperPipeline` to stream English
subtitles. faster-whisper is lazy-imported (and the model is injectable) so this
module loads and tests without it.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from .interface import LanguagePair, Translator, register_translator

JA_EN = LanguagePair("ja", "en")


class WhisperJaEnTranslator:
    """Translate Japanese audio to English segments with Whisper's translate task.

    ``model_size`` is the latency/accuracy lever shared with the ASR pipeline and
    wired to the UI by TASK-1110. Pass ``model=`` to inject a pre-built model
    (used in tests); otherwise faster-whisper is loaded on the GPU.
    """

    def __init__(
        self,
        model_size: str = "small",
        *,
        device: str = "cuda",
        compute_type: str = "float16",
        beam_size: int = 1,
        model: Optional[object] = None,
    ) -> None:
        self.pair = JA_EN
        if model is None:
            from faster_whisper import WhisperModel  # noqa: PLC0415 (lazy: heavy GPU dep)

            model = WhisperModel(model_size, device=device, compute_type=compute_type)
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
