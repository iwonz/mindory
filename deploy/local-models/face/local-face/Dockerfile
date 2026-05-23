FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    MINDORY_FACE_HOST=0.0.0.0 \
    MINDORY_FACE_PORT=8086 \
    MINDORY_FACE_MODEL=mindory-local-face-v1 \
    MINDORY_FACE_EMBEDDING_DIMENSIONS=512 \
    MINDORY_FACE_MIN_AREA_RATIO=0.01 \
    MINDORY_FACE_HEALTH_LOAD_MODEL=true

WORKDIR /opt/mindory-face

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir "numpy==2.0.2" "Pillow==10.4.0" "opencv-python-headless==4.10.0.84"

COPY deploy/local-models/face/local-face/server.py /opt/mindory-face/server.py

EXPOSE 8086

CMD ["python", "/opt/mindory-face/server.py"]
