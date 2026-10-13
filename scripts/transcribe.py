"""Local speech-to-text for the bridge, using faster-whisper (runs on this Mac).

Usage: transcribe.py <audio-file>   prints one JSON line {"text": ..., "language": ...}
       transcribe.py --warmup       downloads/loads the model, then exits
Environment: VOICE_MODEL (default small), VOICE_LANGUAGE (default auto-detect), VOICE_MODEL_DIR
"""
import json
import os
import sys

from faster_whisper import WhisperModel

model_name = os.environ.get("VOICE_MODEL") or "small"
model_dir = os.environ.get("VOICE_MODEL_DIR") or None
model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=model_dir)

if len(sys.argv) > 1 and sys.argv[1] == "--warmup":
    print(json.dumps({"ok": True, "model": model_name}))
    sys.exit(0)

if len(sys.argv) != 2:
    print("usage: transcribe.py <audio-file>", file=sys.stderr)
    sys.exit(2)

segments, info = model.transcribe(
    sys.argv[1],
    language=os.environ.get("VOICE_LANGUAGE") or None,
    vad_filter=True,
    beam_size=1,
    condition_on_previous_text=False,
)
text = " ".join(segment.text.strip() for segment in segments).strip()
print(json.dumps({"text": text, "language": info.language}))
