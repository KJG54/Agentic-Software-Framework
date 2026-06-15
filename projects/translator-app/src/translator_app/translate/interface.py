"""Pluggable language-pair translation interface (TASK-1105).

The app starts with Japanese->English but is meant to grow toward any->any, so
translation backends are selected by :class:`LanguagePair` through a small
registry rather than hard-wired. :func:`create_translator` is the one entry
point callers use; backends register themselves with :func:`register_translator`.

Backend contract
----------------
A translator implements the same streaming shape as the ASR
:class:`~translator_app.asr.whisper_pipeline.Transcriber` -- ``transcribe(audio,
sample_rate)`` returning ``(start, end, text)`` segments in the *target*
language. That is deliberate: Whisper's translate task is audio->English, so the
JA->EN translator drops straight into :class:`WhisperPipeline` and streams
English subtitles with no extra pass. A future text->text backend (for non-
English targets) would adapt to this same contract by consuming ASR text.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Protocol, Tuple


@dataclass(frozen=True)
class LanguagePair:
    """A source->target language selection (ISO-639-1 codes, e.g. ``ja``/``en``)."""

    source: str
    target: str

    def __str__(self) -> str:
        return f"{self.source}->{self.target}"

    @classmethod
    def parse(cls, spec: str) -> "LanguagePair":
        """Parse ``"ja->en"`` / ``"ja-en"`` / ``"ja_en"`` (case-insensitive)."""
        text = spec.strip().lower()
        for sep in ("->", "-", "_"):
            if sep in text:
                source, target = text.split(sep, 1)
                source, target = source.strip(), target.strip()
                if source and target:
                    return cls(source, target)
        raise ValueError(f"cannot parse a language pair from {spec!r} (use 'ja->en')")


class Translator(Protocol):
    """Produces target-language segments from audio (see module docstring)."""

    pair: LanguagePair

    def transcribe(self, audio: object, sample_rate: int) -> Iterable[Tuple[float, float, str]]: ...


class UnsupportedLanguagePairError(KeyError):
    """Raised when no backend is registered for a requested language pair."""


_REGISTRY: Dict[LanguagePair, Callable[..., Translator]] = {}
_builtins_loaded = False


def register_translator(pair: LanguagePair, factory: Callable[..., Translator]) -> None:
    """Register ``factory`` as the backend for ``pair`` (idempotent overwrite)."""
    _REGISTRY[pair] = factory


def _ensure_builtins() -> None:
    global _builtins_loaded
    if not _builtins_loaded:
        from . import whisper_ja_en  # noqa: F401  (import registers the JA->EN backend)

        _builtins_loaded = True


def supported_pairs() -> List[LanguagePair]:
    """All language pairs that currently have a registered backend."""
    _ensure_builtins()
    return sorted(_REGISTRY, key=str)


def create_translator(pair: LanguagePair, **options: object) -> Translator:
    """Build the translator for ``pair``; ``options`` pass through to the backend.

    Raises :class:`UnsupportedLanguagePairError` if nothing is registered.
    """
    _ensure_builtins()
    try:
        factory = _REGISTRY[pair]
    except KeyError:
        raise UnsupportedLanguagePairError(
            f"no translation backend for {pair}; supported: "
            + ", ".join(str(p) for p in supported_pairs())
        ) from None
    return factory(**options)
