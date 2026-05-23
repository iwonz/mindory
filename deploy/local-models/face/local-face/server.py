import base64
import hashlib
import json
import math
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw


HOST = os.environ.get("MINDORY_FACE_HOST", "0.0.0.0")
PORT = int(os.environ.get("MINDORY_FACE_PORT", "8086"))
MODEL = os.environ.get("MINDORY_FACE_MODEL", "mindory-local-face-v1")
EMBEDDING_DIMENSIONS = int(os.environ.get("MINDORY_FACE_EMBEDDING_DIMENSIONS", "512"))
MIN_AREA_RATIO = float(os.environ.get("MINDORY_FACE_MIN_AREA_RATIO", "0.01"))
HEALTH_LOAD_MODEL = os.environ.get("MINDORY_FACE_HEALTH_LOAD_MODEL", "true").lower() == "true"


class JsonHandler(BaseHTTPRequestHandler):
    server_version = "MindoryFace/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        started = time.time()
        try:
            cascade = load_cascade()
            if HEALTH_LOAD_MODEL:
                sample = sample_face_image()
                faces = detect_faces(sample, cascade)
                if not faces:
                    raise RuntimeError("sample face was not detected")
            self.write_json(200, {
                "status": "ok",
                "model": MODEL,
                "roles": ["face-detection", "face-recognition"],
                "backend": "opencv-haar-local-embedding",
                "duration_ms": round((time.time() - started) * 1000),
            })
        except Exception as error:
            self.write_json(503, {
                "status": "error",
                "error": "face_health_failed",
                "message": str(error),
            })

    def do_POST(self) -> None:
        if self.path == "/faces/detect":
            self.handle_faces(recognize=False)
            return
        if self.path == "/faces/recognize":
            self.handle_faces(recognize=True)
            return
        self.send_error(404)

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("content-length", "0"))
        if content_length <= 0:
            raise ValueError("Request body is required.")
        payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def handle_faces(self, recognize: bool) -> None:
        started = time.time()
        try:
            payload = self.read_json_body()
            model = str(payload.get("model") or MODEL)
            image = decode_image_payload(payload)
            faces = detect_faces(image, load_cascade())
            response: dict[str, Any] = {
                "model": model,
                "faces": faces,
                "usage": {
                    "image_count": 1,
                    "face_count": len(faces),
                    "duration_ms": round((time.time() - started) * 1000),
                },
            }
            if recognize:
                response["identity_ids"] = [face["label"] for face in faces]
            self.write_json(200, response)
        except Exception as error:
            self.write_json(422, {
                "error": "face_recognition_failed" if recognize else "face_detection_failed",
                "message": str(error),
                "model": MODEL,
            })

    def write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def decode_image_payload(payload: dict[str, Any]) -> Image.Image:
    data = payload.get("data_base64")
    if not isinstance(data, str) or data.strip() == "":
        raise ValueError("data_base64 is required.")
    raw = base64.b64decode(data, validate=True)
    try:
        image = Image.open(BytesIO(raw))
        image.load()
        return image.convert("RGB")
    except Exception as error:
        raise ValueError(f"Could not decode image bytes: {error}") from error


def load_cascade() -> cv2.CascadeClassifier:
    path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    cascade = cv2.CascadeClassifier(path)
    if cascade.empty():
        raise RuntimeError(f"OpenCV Haar cascade could not be loaded from {path}")
    return cascade


def detect_faces(image: Image.Image, cascade: cv2.CascadeClassifier) -> list[dict[str, Any]]:
    arr = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    min_size = max(24, int(min(image.size) * 0.08))
    detections = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=4, minSize=(min_size, min_size))
    boxes = [
        (int(x), int(y), int(w), int(h), 0.96, "opencv_haar")
        for (x, y, w, h) in detections
    ]
    if not boxes:
        boxes = heuristic_face_boxes(arr)
    faces = []
    for index, (x, y, width, height, confidence, source) in enumerate(boxes[:16]):
        crop = image.crop((x, y, x + width, y + height))
        embedding = face_embedding(crop, EMBEDDING_DIMENSIONS)
        label = face_label(embedding, index)
        faces.append({
            "bounding_box": {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "unit": "px",
                "source": source,
            },
            "embedding": embedding,
            "confidence": confidence,
            "label": label,
        })
    return faces


def heuristic_face_boxes(arr: np.ndarray) -> list[tuple[int, int, int, int, float, str]]:
    height, width, _ = arr.shape
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    skin = (
        (r > 120) & (g > 70) & (b > 45)
        & (r > g) & (g > b * 0.75)
        & ((np.maximum.reduce([r, g, b]) - np.minimum.reduce([r, g, b])) > 18)
    )
    min_area = max(20, int(width * height * MIN_AREA_RATIO))
    if int(np.count_nonzero(skin)) < min_area:
        return []
    ys, xs = np.where(skin)
    x1 = int(xs.min())
    x2 = int(xs.max())
    y1 = int(ys.min())
    y2 = int(ys.max())
    box_width = x2 - x1 + 1
    box_height = y2 - y1 + 1
    if box_width <= 0 or box_height <= 0:
        return []
    aspect = box_width / box_height
    if aspect < 0.45 or aspect > 1.8:
        return []
    pad_x = int(box_width * 0.08)
    pad_y = int(box_height * 0.12)
    x = max(0, x1 - pad_x)
    y = max(0, y1 - pad_y)
    w = min(width - x, box_width + pad_x * 2)
    h = min(height - y, box_height + pad_y * 2)
    confidence = min(0.9, 0.55 + float(np.count_nonzero(skin)) / max(width * height, 1))
    return [(x, y, w, h, round(confidence, 4), "skin_tone_region")]


def face_embedding(image: Image.Image, dimensions: int) -> list[float]:
    if dimensions <= 0:
        raise ValueError("dimensions must be positive.")
    resized = image.convert("RGB").resize((32, 32))
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    gray = np.mean(arr, axis=2)
    features: list[float] = []
    features.extend(gray.flatten().tolist())
    for channel in range(3):
        hist, _ = np.histogram(arr[:, :, channel], bins=24, range=(0.0, 1.0), density=False)
        hist = hist.astype(np.float32)
        hist = hist / max(float(hist.sum()), 1.0)
        features.extend(hist.tolist())
    features.extend([
        float(np.mean(gray)),
        float(np.std(gray)),
        float(np.mean(arr[:, :, 0])),
        float(np.mean(arr[:, :, 1])),
        float(np.mean(arr[:, :, 2])),
        float(image.width / max(image.height, 1)),
    ])
    base = np.asarray(features, dtype=np.float32)
    indexes = np.arange(dimensions)
    mixed = (
        base[(indexes * 31) % base.size] * 0.61
        + base[(indexes * 13 + 7) % base.size] * 0.29
        + np.sin(base[(indexes * 19 + 3) % base.size] * math.pi) * 0.10
    ).astype(np.float32)
    mixed = mixed - float(np.mean(mixed))
    norm = float(np.linalg.norm(mixed))
    if norm <= 0:
        return [0.0 for _ in range(dimensions)]
    return (mixed / norm).round(8).astype(float).tolist()


def face_label(embedding: list[float], index: int) -> str:
    digest = hashlib.sha256(",".join(f"{value:.6f}" for value in embedding).encode("utf-8")).hexdigest()
    return f"local-face-{digest[:16]}-{index + 1}"


def sample_face_image() -> Image.Image:
    image = Image.new("RGB", (240, 240), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((52, 38, 188, 190), fill=(232, 185, 145), outline=(90, 60, 40), width=4)
    draw.ellipse((88, 92, 108, 112), fill=(25, 25, 25))
    draw.ellipse((132, 92, 152, 112), fill=(25, 25, 25))
    draw.arc((88, 116, 152, 166), 20, 160, fill=(120, 40, 40), width=5)
    return image


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), JsonHandler)
    print(f"Mindory face runner listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
