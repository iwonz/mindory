#!/usr/bin/env python3
import base64
import json
import math
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from faster_whisper import WhisperModel
except Exception as exc:
    WhisperModel = None
    WHISPER_IMPORT_ERROR = exc
else:
    WHISPER_IMPORT_ERROR = None


HOST = os.environ.get("MINDORY_ASR_HOST", "0.0.0.0")
PORT = int(os.environ.get("MINDORY_ASR_PORT", "8084"))
MODEL = os.environ.get("MINDORY_ASR_MODEL", "Systran/faster-whisper-tiny.en")
DEVICE = os.environ.get("MINDORY_ASR_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("MINDORY_ASR_COMPUTE_TYPE", "int8")
LANGUAGE = os.environ.get("MINDORY_ASR_LANGUAGE", "en").strip() or None
BEAM_SIZE = int(os.environ.get("MINDORY_ASR_BEAM_SIZE", "5"))
VAD_FILTER = os.environ.get("MINDORY_ASR_VAD_FILTER", "false").lower() in {"1", "true", "yes", "on"}
TIMEOUT_SECONDS = int(os.environ.get("MINDORY_ASR_TIMEOUT_MS", "120000")) / 1000
HEALTH_LOAD_MODEL = os.environ.get("MINDORY_ASR_HEALTH_LOAD_MODEL", "true").lower() in {"1", "true", "yes", "on"}
MODEL_DIR = os.environ.get("MINDORY_ASR_MODEL_DIR", "/data/mindory/models/whisper")

MODEL_LOCK = threading.Lock()
MODEL_INSTANCE = None
MODEL_NAME = None


class MindoryAsrHandler(BaseHTTPRequestHandler):
    server_version = "mindory-faster-whisper-asr/1.0"

    def do_GET(self):
        if self.path != "/health":
            self.write_json(404, {"error": "not_found"})
            return
        try:
            if WhisperModel is None:
                raise RuntimeError(f"faster-whisper import failed: {WHISPER_IMPORT_ERROR}")
            if HEALTH_LOAD_MODEL:
                load_model(MODEL)
            self.write_json(200, {
                "status": "ok",
                "service": "mindory-faster-whisper-asr",
                "engine": "faster-whisper",
                "model": MODEL,
                "device": DEVICE,
                "compute_type": COMPUTE_TYPE,
                "language": LANGUAGE,
                "vad_filter": VAD_FILTER
            })
        except Exception as exc:
            self.write_json(503, {
                "status": "failed",
                "service": "mindory-faster-whisper-asr",
                "error": str(exc)
            })

    def do_POST(self):
        if self.path != "/asr":
            self.write_json(404, {"error": "not_found"})
            return
        started_at = time.time()
        try:
            body = self.read_json()
            model = string_value(body.get("model"), MODEL)
            mime_type = string_value(body.get("mime_type") or body.get("mimeType"), "application/octet-stream")
            data = decode_data(body)
            transcript = transcribe_bytes(data, mime_type, model)
            transcript["usage"] = {
                **transcript.get("usage", {}),
                "duration_ms": int((time.time() - started_at) * 1000)
            }
            self.write_json(200, transcript)
        except Exception as exc:
            self.write_json(500, {
                "error": "asr_failed",
                "message": str(exc)
            })

    def read_json(self):
        length = int(self.headers.get("content-length", "0"))
        payload = self.rfile.read(length).decode("utf-8")
        return json.loads(payload or "{}")

    def write_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), fmt % args), flush=True)


def load_model(model_name):
    global MODEL_INSTANCE, MODEL_NAME
    with MODEL_LOCK:
        if MODEL_INSTANCE is not None and MODEL_NAME == model_name:
            return MODEL_INSTANCE
        if WhisperModel is None:
            raise RuntimeError(f"faster-whisper import failed: {WHISPER_IMPORT_ERROR}")
        Path(MODEL_DIR).mkdir(parents=True, exist_ok=True)
        MODEL_INSTANCE = WhisperModel(
            model_name,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            download_root=MODEL_DIR
        )
        MODEL_NAME = model_name
        return MODEL_INSTANCE


def transcribe_bytes(data, mime_type, model_name):
    suffix = audio_suffix(mime_type, data)
    with tempfile.TemporaryDirectory(prefix="mindory-asr-") as temp_dir:
        audio_path = Path(temp_dir) / f"input{suffix}"
        audio_path.write_bytes(data)
        model = load_model(model_name)
        started_at = time.time()
        segments_iter, info = model.transcribe(
            str(audio_path),
            beam_size=BEAM_SIZE,
            language=LANGUAGE,
            vad_filter=VAD_FILTER
        )
        segments = []
        text_parts = []
        for index, segment in enumerate(segments_iter):
            segment_text = segment.text.strip()
            if not segment_text:
                continue
            text_parts.append(segment_text)
            segments.append({
                "segment_index": index,
                "text": segment_text,
                "start_ms": max(0, int(segment.start * 1000)),
                "end_ms": max(0, int(segment.end * 1000)),
                "confidence": confidence_from_avg_logprob(getattr(segment, "avg_logprob", None))
            })
            if time.time() - started_at > TIMEOUT_SECONDS:
                raise RuntimeError(f"ASR timed out after {TIMEOUT_SECONDS:.0f}s.")
        detected_duration = number_or_none(getattr(info, "duration", None))
        usage = {}
        if detected_duration is not None:
            usage["audio_seconds"] = detected_duration
        return {
            "model": model_name,
            "text": " ".join(text_parts).strip(),
            "segments": segments,
            "duration_seconds": detected_duration,
            "language": getattr(info, "language", None),
            "language_probability": number_or_none(getattr(info, "language_probability", None)),
            "usage": usage
        }


def confidence_from_avg_logprob(value):
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return max(0.0, min(1.0, math.exp(value)))


def number_or_none(value):
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def decode_data(body):
    for key in ("data_base64", "dataBase64", "audio_base64", "file_base64"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return base64.b64decode(value)
    raise ValueError("ASR request requires data_base64.")


def audio_suffix(mime_type, data):
    normalized = mime_type.lower()
    if normalized in {"audio/wav", "audio/x-wav"} or data.startswith(b"RIFF"):
        return ".wav"
    if normalized in {"audio/mpeg", "audio/mp3"}:
        return ".mp3"
    if normalized in {"audio/mp4", "audio/m4a", "audio/x-m4a"}:
        return ".m4a"
    if normalized == "audio/flac" or data.startswith(b"fLaC"):
        return ".flac"
    if normalized == "audio/ogg" or data.startswith(b"OggS"):
        return ".ogg"
    if normalized == "audio/opus":
        return ".opus"
    return ".audio"


def string_value(value, fallback):
    return value if isinstance(value, str) and value.strip() else fallback


def optional_string(value):
    return value if isinstance(value, str) and value.strip() else None


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), MindoryAsrHandler)
    print(f"Mindory Faster Whisper ASR runner listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
