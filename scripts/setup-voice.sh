#!/bin/bash
# Installs free, private, on-device speech-to-text (faster-whisper) for voice messages.
# Downloads about 200 MB of libraries plus the model (small = about 480 MB). Run from normal Terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=""
for candidate in "${PYTHON_BIN:-}" "$(command -v python3 || true)" "$HOME/.aside/runtime/bin/python3"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then echo 'Python 3.9+ not found. Install it, or set PYTHON_BIN=/path/to/python3 and run again.'; exit 1; fi
echo "Using $PY"
mkdir -p voice/site voice/models
"$PY" -m pip install --upgrade --disable-pip-version-check --target voice/site faster-whisper
echo "$PY" > voice/python
echo 'Downloading the speech model (first time only)...'
VOICE_MODEL="${VOICE_MODEL:-small}" VOICE_MODEL_DIR="$PWD/voice/models" HF_HOME="$PWD/voice/models" PYTHONPATH="$PWD/voice/site" "$PY" scripts/transcribe.py --warmup
echo 'Voice transcription is ready. Restart the bridge to use it.'
echo 'Tip: set VOICE_MODEL=base for faster, less accurate results, or VOICE_LANGUAGE=en to skip language detection.'
