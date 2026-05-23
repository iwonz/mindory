FROM ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddle:3.0.0

ENV PYTHONUNBUFFERED=1 \
    PADDLEOCR_HOME=/data/mindory/models/paddleocr \
    MINDORY_OCR_HOST=0.0.0.0 \
    MINDORY_OCR_PORT=8083

WORKDIR /opt/mindory-ocr

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir "paddleocr[all]==3.2.0" "pillow==11.0.0" "pypdfium2==4.30.0"

COPY deploy/local-models/ocr/paddleocr/server.py /opt/mindory-ocr/server.py

EXPOSE 8083

CMD ["python", "/opt/mindory-ocr/server.py"]
