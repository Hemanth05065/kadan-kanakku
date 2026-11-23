FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# CPU build of PyTorch; use the CUDA wheel index on a GPU host.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir git+https://github.com/huggingface/parler-tts.git fastapi "uvicorn[standard]" soundfile

COPY server.py .
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
