"""translator-app: a Windows system-audio translation overlay.

Captures loopback audio, transcribes and translates it in real time
(Japanese -> English to start), and renders the result as subtitles on a
full-screen, transparent, click-through overlay.

This package is the skeleton seeded by TASK-1101; the audio, ASR, translation,
and overlay subsystems are filled in by the later tasks in the plan.
"""

__version__ = "0.0.1"

__all__ = ["__version__"]
