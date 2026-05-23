#!/usr/bin/env python3
import base64
import csv
import json
import os
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path

try:
    import pypdfium2 as pdfium
except Exception as exc:
    pdfium = None
    PDF_IMPORT_ERROR = exc
else:
    PDF_IMPORT_ERROR = None


HOST = os.environ.get("MINDORY_OCR_HOST", "0.0.0.0")
PORT = int(os.environ.get("MINDORY_OCR_PORT", "8083"))
MODEL = os.environ.get("MINDORY_OCR_MODEL", "tesseract-eng")
LANG = os.environ.get("MINDORY_OCR_LANG", "eng")
PSM = os.environ.get("MINDORY_OCR_PSM", "6")
MAX_PDF_PAGES = int(os.environ.get("MINDORY_OCR_MAX_PDF_PAGES", "50"))
TIMEOUT_SECONDS = int(os.environ.get("MINDORY_OCR_TIMEOUT_MS", "120000")) / 1000
HEALTH_RUN_ENGINE = os.environ.get("MINDORY_OCR_HEALTH_LOAD_MODEL", "true").lower() in {"1", "true", "yes", "on"}


class MindoryOcrHandler(BaseHTTPRequestHandler):
    server_version = "mindory-tesseract-ocr/1.0"

    def do_GET(self):
        if self.path != "/health":
            self.write_json(404, {"error": "not_found"})
            return
        try:
            version = tesseract_version()
            if HEALTH_RUN_ENGINE:
                verify_tesseract_language()
            self.write_json(200, {
                "status": "ok",
                "service": "mindory-tesseract-ocr",
                "engine": "tesseract",
                "model": MODEL,
                "lang": LANG,
                "psm": PSM,
                "pdf": pdfium is not None,
                "version": version
            })
        except Exception as exc:
            self.write_json(503, {
                "status": "failed",
                "service": "mindory-tesseract-ocr",
                "error": str(exc)
            })

    def do_POST(self):
        if self.path != "/ocr":
            self.write_json(404, {"error": "not_found"})
            return
        started_at = time.time()
        try:
            body = self.read_json()
            model = string_value(body.get("model"), MODEL)
            mime_type = string_value(body.get("mime_type") or body.get("mimeType"), "application/octet-stream")
            data = decode_data(body)
            pages = recognize_bytes(data, mime_type)
            text = "\n\n".join(page["text"] for page in pages if page["text"].strip())
            self.write_json(200, {
                "model": model,
                "text": text,
                "pages": pages,
                "usage": {
                    "duration_ms": int((time.time() - started_at) * 1000)
                }
            })
        except Exception as exc:
            self.write_json(500, {
                "error": "ocr_failed",
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


def tesseract_version():
    result = run_tesseract(["--version"])
    return result.stdout.splitlines()[0] if result.stdout else "tesseract"


def verify_tesseract_language():
    result = run_tesseract(["--list-langs"])
    languages = set(result.stdout.splitlines()[1:])
    if LANG not in languages:
        raise RuntimeError(f"Tesseract language '{LANG}' is not installed. Available languages: {', '.join(sorted(languages))}")


def recognize_bytes(data, mime_type):
    if is_pdf(data, mime_type):
        return recognize_pdf(data)
    return recognize_image(data, mime_type)


def recognize_pdf(data):
    if pdfium is None:
        raise RuntimeError(f"PDF OCR requires pypdfium2: {PDF_IMPORT_ERROR}")
    pages = []
    with tempfile.TemporaryDirectory(prefix="mindory-ocr-pdf-") as temp_dir:
        pdf_path = Path(temp_dir) / "input.pdf"
        pdf_path.write_bytes(data)
        document = pdfium.PdfDocument(str(pdf_path))
        page_count = min(len(document), MAX_PDF_PAGES)
        for index in range(page_count):
            page = document[index]
            image = page.render(scale=2).to_pil()
            image_path = Path(temp_dir) / f"page-{index + 1}.png"
            image.save(image_path)
            text, confidence = recognize_path(image_path)
            pages.append(page_payload(index + 1, text, confidence))
    return pages


def recognize_image(data, mime_type):
    suffix = image_suffix(mime_type, data)
    with tempfile.TemporaryDirectory(prefix="mindory-ocr-image-") as temp_dir:
        image_path = Path(temp_dir) / f"input{suffix}"
        image_path.write_bytes(data)
        text, confidence = recognize_path(image_path)
        return [page_payload(1, text, confidence)]


def recognize_path(path):
    result = run_tesseract([str(path), "stdout", "-l", LANG, "--psm", PSM, "tsv"])
    rows = list(csv.DictReader(StringIO(result.stdout), delimiter="\t"))
    words = []
    confidences = []
    for row in rows:
        text = (row.get("text") or "").strip()
        if text:
            words.append(text)
        conf = row.get("conf")
        if is_number(conf) and float(conf) >= 0:
            confidences.append(float(conf))
    return " ".join(words), average(confidences)


def run_tesseract(args):
    try:
        return subprocess.run(["tesseract", *args], check=True, capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Tesseract failed: {(exc.stderr or exc.stdout).strip()}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Tesseract timed out after {TIMEOUT_SECONDS:.0f}s.") from exc


def decode_data(body):
    for key in ("data_base64", "dataBase64", "image_base64", "file_base64"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return base64.b64decode(value)
    raise ValueError("OCR request requires data_base64.")


def page_payload(page_number, text, confidence):
    payload = {
        "page_number": page_number,
        "text": text
    }
    if confidence is not None:
        payload["confidence"] = confidence
    return payload


def average(values):
    numeric = [float(value) for value in values if is_number(value)]
    if not numeric:
        return None
    return sum(numeric) / len(numeric)


def is_number(value):
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def is_pdf(data, mime_type):
    return mime_type.lower() == "application/pdf" or data.startswith(b"%PDF")


def image_suffix(mime_type, data):
    normalized = mime_type.lower()
    if normalized in {"image/jpeg", "image/jpg"} or data.startswith(b"\xff\xd8"):
        return ".jpg"
    if normalized == "image/png" or data.startswith(b"\x89PNG"):
        return ".png"
    if normalized == "image/bmp" or data.startswith(b"BM"):
        return ".bmp"
    if normalized == "image/x-portable-pixmap" or data.startswith(b"P6\n") or data.startswith(b"P3\n"):
        return ".ppm"
    if normalized in {"image/tiff", "image/tif"}:
        return ".tiff"
    return ".img"


def string_value(value, fallback):
    return value if isinstance(value, str) and value.strip() else fallback


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), MindoryOcrHandler)
    print(f"Mindory Tesseract OCR runner listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
