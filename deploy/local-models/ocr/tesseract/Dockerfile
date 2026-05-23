FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    MINDORY_OCR_HOST=0.0.0.0 \
    MINDORY_OCR_PORT=8083 \
    MINDORY_OCR_MODEL=tesseract-eng \
    MINDORY_OCR_LANG=eng

WORKDIR /opt/mindory-ocr

RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core tesseract-ocr tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir "pillow==11.0.0" "pypdfium2==4.30.0"

COPY deploy/local-models/ocr/tesseract/server.py /opt/mindory-ocr/server.py

EXPOSE 8083

CMD ["python", "/opt/mindory-ocr/server.py"]
