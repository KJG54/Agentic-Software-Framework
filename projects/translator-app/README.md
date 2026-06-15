# translator-app

A lightweight Windows desktop overlay that listens to your system audio,
transcribes and translates it in real time, and shows the result as subtitles
over whatever you're watching. Built for **Japanese → English** to start (e.g.
anime on a streaming service), with a pluggable language-pair interface so other
pairs can be added later.

The overlay is full-screen, transparent, click-through, and always-on-top, so it
floats over any application without stealing focus or clicks. A settings bar
hides at the top of the screen and reveals on hover; an Exit button sits in the
top-right corner.

## Requirements

- **Windows** (uses WASAPI loopback to capture system audio).
- **Python 3.11+**.
- An **NVIDIA GPU with CUDA** for real-time Whisper inference (CPU works but is
  much slower and may not keep up).

## Setup

Create a virtual environment and install the runtime dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install faster-whisper PySide6 PyAudioWPatch numpy
```

faster-whisper pulls in `ctranslate2`; for GPU you also need a matching CUDA
runtime installed on the machine (it is not shipped by this app).

## Run (from source)

```powershell
python -m translator_app --launch
```

This picks a loopback device (the interactive console picker appears if you have
more than one), starts capture + transcription + translation, and shows the
overlay. Change the language pair, font size, position, opacity, and model size
from the hover-reveal settings bar; exit from the settings bar or the top-right
button. `python -m translator_app --version` prints the version.

> **Settings are ephemeral.** Nothing is saved — every launch starts from the
> defaults (ja→en, `small` model, bottom-centered subtitles).

### Latency vs. accuracy

The **model size** control is the trade-off lever: `tiny`/`base` are fast and
rough, `small` (default) is a good balance, `medium`/`large-v3` are slower but
more accurate. Changing it reconfigures the live pipeline; because that reloads
the model weights, expect a brief hitch when you switch.

## Build the Windows executable

Install PyInstaller and build with the bundled spec:

```powershell
pip install pyinstaller
pyinstaller packaging/translator-app.spec
```

This produces a single windowed executable at **`dist/translator-app.exe`**.
Double-click it to run — no console window appears (it's an overlay app).

### Model / runtime bundling strategy

- **The Python runtime and code dependencies are bundled** into the exe
  (PySide6, numpy, ctranslate2/faster-whisper, PyAudioWPatch) via the spec's
  `hiddenimports`.
- **The Whisper model weights are *not* bundled.** faster-whisper **downloads**
  the selected model from Hugging Face on first use and **caches** it under
  `%USERPROFILE%\.cache\huggingface`. This keeps the exe small and lets the
  model-size switch fetch other sizes on demand. The first run of a given model
  size needs an internet connection; subsequent runs use the cache.
- **CUDA is expected on the host**, not shipped inside the exe.

## Project layout

```
src/translator_app/
  audio/      device enumeration + WASAPI loopback capture
  asr/        streaming Whisper pipeline (partial + final segments)
  translate/  pluggable language-pair interface (ja→en backend)
  ui/         overlay window, subtitle renderer, settings bar, exit controls
  settings.py ephemeral settings + latency/accuracy pipeline wiring
  app.py      application shell + ASR worker + clean shutdown
  launcher.py assembles and runs the overlay (the --launch path)
packaging/    PyInstaller entry script + spec
tests/        stdlib unittest suite (python -m unittest discover -s tests)
```
