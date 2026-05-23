FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    MINDORY_ASR_HOST=0.0.0.0 \
    MINDORY_ASR_PORT=8084 \
    MINDORY_ASR_MODEL=Systran/faster-whisper-tiny.en \
    MINDORY_ASR_DEVICE=cpu \
    MINDORY_ASR_COMPUTE_TYPE=int8 \
    MINDORY_ASR_LANGUAGE=en

WORKDIR /opt/mindory-asr

RUN apt-get update \
  && apt-get install -y --no-install-recommends espeak-ng ffmpeg libgomp1 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir "faster-whisper==1.1.1" "requests==2.32.3"

COPY deploy/local-models/asr/faster-whisper/server.py /opt/mindory-asr/server.py

EXPOSE 8084

CMD ["python", "/opt/mindory-asr/server.py"]
