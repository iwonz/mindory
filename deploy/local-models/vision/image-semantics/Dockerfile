FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    MINDORY_IMAGE_SEMANTICS_HOST=0.0.0.0 \
    MINDORY_IMAGE_SEMANTICS_PORT=8082 \
    MINDORY_IMAGE_SEMANTICS_MODEL=mindory-image-semantics-v1 \
    MINDORY_IMAGE_SEMANTICS_EMBEDDING_DIMENSIONS=1536 \
    MINDORY_IMAGE_SEMANTICS_MIN_OBJECT_AREA_RATIO=0.015 \
    MINDORY_IMAGE_SEMANTICS_HEALTH_LOAD_MODEL=true

WORKDIR /opt/mindory-image-semantics

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir "numpy==2.0.2" "Pillow==10.4.0"

COPY deploy/local-models/vision/image-semantics/server.py /opt/mindory-image-semantics/server.py

EXPOSE 8082

CMD ["python", "/opt/mindory-image-semantics/server.py"]
