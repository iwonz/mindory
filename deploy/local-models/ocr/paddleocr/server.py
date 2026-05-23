#!/usr/bin/env python3
import base64
import json
import os
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

try:
    import pypdfium2 as pdfium
except Exception as exc:
    pdfium = None
    PDF_IMPORT_ERROR = exc
else:
    PDF_IMPORT_ERROR = None

try:
    from paddleocr import PaddleOCR
except Exception as exc:
    PaddleOCR = None
    PADDLE_IMPORT_ERROR = exc
else:
    PADDLE_IMPORT_ERROR = None


HOST = os.environ.get("MINDORY_OCR_HOST", "0.0.0.0")
PORT = int(os.environ.get("MINDORY_OCR_PORT", "8083"))
MODEL = os.environ.get("MINDORY_OCR_MODEL", "ESLAV__PP-OCRv5_mobile")
LANG = os.environ.get("MINDORY_OCR_LANG", "en")
MAX_PDF_PAGES = int(os.environ.get("MINDORY_OCR_MAX_PDF_PAGES", "50"))
HEALTH_LOAD_MODEL = os.environ.get("MINDORY_OCR_HEALTH_LOAD_MODEL", "true").lower() in {"1", "true", "yes", "on"}

_OCR = None
_OCR_LOCK = Lock()


class MindoryOcrHandler(BaseHTTPRequestHandler):
    server_version = "mindory-paddleocr/1.0"

    def do_GET(self):
        if self.path != "/health":
            self.write_json(404, {"error": "not_found"})
            return
        try:
            if PADDLE_IMPORT_ERROR is not None:
                raise RuntimeError(f"PaddleOCR import failed: {PADDLE_IMPORT_ERROR}")
            if HEALTH_LOAD_MODEL:
                ensure_ocr()
            self.write_json(200, {
                "status": "ok",
                "service": "mindory-paddleocr",
                "model": MODEL,
                "lang": LANG,
                "pdf": pdfium is not None,
                "model_loaded": _OCR is not None
            })
        except Exception as exc:
            self.write_json(503, {
                "status": "failed",
                "service": "mindory-paddleocr",
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


def ensure_ocr():
    global _OCR
    if _OCR is not None:
        return _OCR
    with _OCR_LOCK:
        if _OCR is not None:
            return _OCR
        if PaddleOCR is None:
            raise RuntimeError(f"PaddleOCR import failed: {PADDLE_IMPORT_ERROR}")
        _OCR = create_paddle_ocr()
        return _OCR


def create_paddle_ocr():
    candidates = [
        {
            "lang": LANG,
            "ocr_version": "PP-OCRv5",
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False
        },
        {
            "lang": LANG,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False
        },
        {
            "lang": LANG,
            "use_angle_cls": True
        },
        {
            "lang": LANG
        }
    ]
    last_error = None
    for kwargs in candidates:
        try:
            return PaddleOCR(**kwargs)
        except (TypeError, ValueError) as exc:
            last_error = exc
    raise RuntimeError(f"Could not initialize PaddleOCR with supported constructor options: {last_error}")


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
    ocr = ensure_ocr()
    if hasattr(ocr, "predict"):
        raw = ocr.predict(input=str(path))
    else:
        raw = ocr.ocr(str(path), cls=True)
    texts, scores = extract_ocr_texts(raw)
    text = "\n".join(unique_nonempty(texts))
    confidence = average(scores)
    return text, confidence


def extract_ocr_texts(value):
    texts = []
    scores = []

    def visit(node):
        if node is None:
            return
        if isinstance(node, dict):
            payload = node.get("res") if isinstance(node.get("res"), dict) else node
            for key in ("rec_texts", "texts"):
                if isinstance(payload.get(key), list):
                    texts.extend(str(item) for item in payload[key])
            for key in ("rec_scores", "scores"):
                if isinstance(payload.get(key), list):
                    scores.extend(float(item) for item in payload[key] if is_number(item))
            for key in ("text", "transcription"):
                if isinstance(payload.get(key), str):
                    texts.append(payload[key])
            for child in payload.values():
                if child is not payload:
                    visit(child)
            return
        if isinstance(node, (list, tuple)):
            if len(node) == 2 and isinstance(node[0], str) and is_number(node[1]):
                texts.append(node[0])
                scores.append(float(node[1]))
                return
            for child in node:
                visit(child)
            return
        json_value = getattr(node, "json", None)
        if callable(json_value):
            try:
                json_value = json_value()
            except Exception:
                json_value = None
        if isinstance(json_value, dict):
            visit(json_value)
            return
        to_json = getattr(node, "to_json", None)
        if callable(to_json):
            try:
                visit(to_json())
                return
            except Exception:
                pass
        if hasattr(node, "__dict__"):
            visit(vars(node))

    visit(value)
    return texts, scores


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


def unique_nonempty(values):
    seen = set()
    result = []
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


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
    if normalized in {"image/tiff", "image/tif"}:
        return ".tiff"
    return ".img"


def string_value(value, fallback):
    return value if isinstance(value, str) and value.strip() else fallback


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), MindoryOcrHandler)
    print(f"Mindory PaddleOCR runner listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
