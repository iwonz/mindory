import base64
import json
import math
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image, ImageStat


HOST = os.environ.get("MINDORY_IMAGE_SEMANTICS_HOST", "0.0.0.0")
PORT = int(os.environ.get("MINDORY_IMAGE_SEMANTICS_PORT", "8082"))
MODEL = os.environ.get("MINDORY_IMAGE_SEMANTICS_MODEL", "mindory-image-semantics-v1")
DEFAULT_DIMENSIONS = int(os.environ.get("MINDORY_IMAGE_SEMANTICS_EMBEDDING_DIMENSIONS", "1536"))
MIN_OBJECT_AREA_RATIO = float(os.environ.get("MINDORY_IMAGE_SEMANTICS_MIN_OBJECT_AREA_RATIO", "0.015"))
HEALTH_LOAD_MODEL = os.environ.get("MINDORY_IMAGE_SEMANTICS_HEALTH_LOAD_MODEL", "true").lower() == "true"

COLOR_RULES = [
    ("red object", lambda r, g, b: (r > 110) & (r > g * 1.35) & (r > b * 1.35)),
    ("green object", lambda r, g, b: (g > 100) & (g > r * 1.25) & (g > b * 1.25)),
    ("blue object", lambda r, g, b: (b > 100) & (b > r * 1.25) & (b > g * 1.15)),
    ("yellow object", lambda r, g, b: (r > 130) & (g > 120) & (b < 110)),
    ("purple object", lambda r, g, b: (r > 100) & (b > 100) & (g < 120)),
    ("dark object", lambda r, g, b: ((r + g + b) / 3) < 55),
    ("light object", lambda r, g, b: ((r + g + b) / 3) > 220),
]


class JsonHandler(BaseHTTPRequestHandler):
    server_version = "MindoryImageSemantics/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        started = time.time()
        try:
            if HEALTH_LOAD_MODEL:
                probe = Image.new("RGB", (32, 32), "white")
                analyze_image(probe)
                image_embedding(probe, DEFAULT_DIMENSIONS)
            self.write_json(200, {
                "status": "ok",
                "model": MODEL,
                "roles": ["image-embedding", "vision-captioning", "object-detection"],
                "backend": "mindory-local-image-semantics",
                "duration_ms": round((time.time() - started) * 1000),
            })
        except Exception as error:
            self.write_json(503, {
                "status": "error",
                "error": "image_semantics_health_failed",
                "message": str(error),
            })

    def do_POST(self) -> None:
        if self.path == "/embeddings/images":
            self.handle_image_embeddings()
            return
        if self.path == "/vision/caption":
            self.handle_caption()
            return
        if self.path == "/vision/objects":
            self.handle_objects()
            return
        self.send_error(404)

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("content-length", "0"))
        if content_length <= 0:
            raise ValueError("Request body is required.")
        raw = self.rfile.read(content_length)
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def handle_image_embeddings(self) -> None:
        started = time.time()
        try:
            payload = self.read_json_body()
            model = str(payload.get("model") or MODEL)
            dimensions = int(payload.get("dimensions") or DEFAULT_DIMENSIONS)
            images = payload.get("images")
            if not isinstance(images, list) or len(images) == 0:
                raise ValueError("images must be a non-empty array.")
            embeddings = []
            for item in images:
                if not isinstance(item, dict):
                    raise ValueError("Each image item must be an object.")
                image = decode_image_payload(item)
                embeddings.append(image_embedding(image, dimensions))
            self.write_json(200, {
                "model": model,
                "embeddings": embeddings,
                "usage": {
                    "image_count": len(embeddings),
                    "embedding_dimensions": dimensions,
                    "duration_ms": round((time.time() - started) * 1000),
                },
            })
        except Exception as error:
            self.write_json(422, {
                "error": "image_embedding_failed",
                "message": str(error),
                "model": MODEL,
            })

    def handle_caption(self) -> None:
        started = time.time()
        try:
            payload = self.read_json_body()
            model = str(payload.get("model") or MODEL)
            image = decode_image_payload(payload)
            analysis = analyze_image(image)
            self.write_json(200, {
                "model": model,
                "caption": build_caption(analysis),
                "labels": analysis["labels"],
                "usage": {
                    "image_count": 1,
                    "duration_ms": round((time.time() - started) * 1000),
                },
            })
        except Exception as error:
            self.write_json(422, {
                "error": "vision_failed",
                "message": str(error),
                "model": MODEL,
            })

    def handle_objects(self) -> None:
        started = time.time()
        try:
            payload = self.read_json_body()
            model = str(payload.get("model") or MODEL)
            image = decode_image_payload(payload)
            analysis = analyze_image(image)
            self.write_json(200, {
                "model": model,
                "objects": analysis["objects"],
                "labels": sorted({obj["label"] for obj in analysis["objects"]}),
                "usage": {
                    "image_count": 1,
                    "duration_ms": round((time.time() - started) * 1000),
                },
            })
        except Exception as error:
            self.write_json(422, {
                "error": "object_detection_failed",
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


def analyze_image(image: Image.Image) -> dict[str, Any]:
    width, height = image.size
    orientation = "square" if width == height else "landscape" if width > height else "portrait"
    resized = image.copy()
    resized.thumbnail((320, 320))
    arr = np.asarray(resized.convert("RGB"), dtype=np.float32)
    stats = ImageStat.Stat(image.convert("RGB"))
    mean = stats.mean
    brightness = float(np.mean(arr))
    contrast = float(np.std(arr))
    color_labels = dominant_color_labels(arr)
    objects = detect_color_objects(arr, width, height)
    edge_density = estimate_edge_density(arr)
    labels = [
        orientation,
        "bright image" if brightness >= 170 else "dark image" if brightness <= 85 else "balanced lighting",
        "high contrast" if contrast >= 65 else "low contrast" if contrast <= 28 else "moderate contrast",
        "edge rich" if edge_density >= 0.12 else "smooth image",
        *color_labels,
        *[obj["label"] for obj in objects],
    ]
    return {
        "width": width,
        "height": height,
        "orientation": orientation,
        "brightness": round(brightness / 255, 4),
        "contrast": round(contrast / 255, 4),
        "mean_rgb": [round(channel, 2) for channel in mean],
        "edge_density": round(edge_density, 4),
        "labels": sorted({label for label in labels if label}),
        "objects": objects,
    }


def dominant_color_labels(arr: np.ndarray) -> list[str]:
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    labels: list[str] = []
    total = max(arr.shape[0] * arr.shape[1], 1)
    for label, rule in COLOR_RULES[:5]:
        fraction = float(np.count_nonzero(rule(r, g, b))) / total
        if fraction >= 0.05:
            labels.append(label.replace(" object", ""))
    return labels


def detect_color_objects(arr: np.ndarray, original_width: int, original_height: int) -> list[dict[str, Any]]:
    height, width, _ = arr.shape
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    min_area = max(12, int(width * height * MIN_OBJECT_AREA_RATIO))
    objects: list[dict[str, Any]] = []
    for label, rule in COLOR_RULES:
        mask = rule(r, g, b)
        if int(np.count_nonzero(mask)) < min_area:
            continue
        ys, xs = np.where(mask)
        if xs.size == 0 or ys.size == 0:
            continue
        x1 = int(xs.min())
        x2 = int(xs.max())
        y1 = int(ys.min())
        y2 = int(ys.max())
        area = int(xs.size)
        if area < min_area:
            continue
        scale_x = original_width / max(width, 1)
        scale_y = original_height / max(height, 1)
        objects.append({
            "label": label,
            "confidence": round(min(0.99, 0.45 + area / max(width * height, 1)), 4),
            "bounding_box": {
                "x": round(x1 * scale_x, 2),
                "y": round(y1 * scale_y, 2),
                "width": round((x2 - x1 + 1) * scale_x, 2),
                "height": round((y2 - y1 + 1) * scale_y, 2),
            },
        })
    return sorted(objects, key=lambda item: item["confidence"], reverse=True)[:16]


def estimate_edge_density(arr: np.ndarray) -> float:
    gray = np.mean(arr, axis=2)
    dx = np.abs(np.diff(gray, axis=1))
    dy = np.abs(np.diff(gray, axis=0))
    edges = np.count_nonzero(dx > 35) + np.count_nonzero(dy > 35)
    possible = max(dx.size + dy.size, 1)
    return float(edges / possible)


def build_caption(analysis: dict[str, Any]) -> str:
    objects = analysis["objects"]
    object_phrase = "no large color-separated objects"
    if objects:
        counts: dict[str, int] = {}
        for obj in objects:
            counts[obj["label"]] = counts.get(obj["label"], 0) + 1
        object_phrase = ", ".join(f"{count} {label}" for label, count in sorted(counts.items()))
    labels = ", ".join(analysis["labels"][:8])
    return (
        f"Image semantics: {analysis['orientation']} {analysis['width']}x{analysis['height']} image "
        f"with {object_phrase}. Visual labels: {labels}."
    )


def image_embedding(image: Image.Image, dimensions: int) -> list[float]:
    if dimensions <= 0:
        raise ValueError("dimensions must be positive.")
    resized = image.convert("RGB").resize((64, 64))
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    features: list[float] = []
    for channel in range(3):
        hist, _ = np.histogram(arr[:, :, channel], bins=32, range=(0.0, 1.0), density=False)
        hist = hist.astype(np.float32)
        hist = hist / max(float(hist.sum()), 1.0)
        features.extend(hist.tolist())
    gray = np.mean(arr, axis=2)
    small_gray = np.asarray(Image.fromarray(np.uint8(gray * 255)).resize((16, 16)), dtype=np.float32) / 255.0
    features.extend(small_gray.flatten().tolist())
    dx = np.abs(np.diff(gray, axis=1))
    dy = np.abs(np.diff(gray, axis=0))
    edge_values = np.concatenate([dx.flatten(), dy.flatten()])
    edge_hist, _ = np.histogram(edge_values, bins=32, range=(0.0, 1.0), density=False)
    edge_hist = edge_hist.astype(np.float32)
    edge_hist = edge_hist / max(float(edge_hist.sum()), 1.0)
    features.extend(edge_hist.tolist())
    features.extend([
        float(np.mean(gray)),
        float(np.std(gray)),
        float(np.mean(arr[:, :, 0])),
        float(np.mean(arr[:, :, 1])),
        float(np.mean(arr[:, :, 2])),
        float(image.width / max(image.height, 1)),
    ])
    base = np.asarray(features, dtype=np.float32)
    if base.size == 0:
        base = np.asarray([0.0], dtype=np.float32)
    indexes = np.arange(dimensions)
    mixed = (
        base[(indexes * 37) % base.size] * 0.63
        + base[(indexes * 17 + 11) % base.size] * 0.27
        + np.sin(base[(indexes * 29 + 5) % base.size] * math.pi) * 0.10
    ).astype(np.float32)
    mixed = mixed - float(np.mean(mixed))
    norm = float(np.linalg.norm(mixed))
    if norm <= 0:
        return [0.0 for _ in range(dimensions)]
    return (mixed / norm).round(8).astype(float).tolist()


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), JsonHandler)
    print(f"Mindory image semantics runner listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
