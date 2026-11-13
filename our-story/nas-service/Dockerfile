FROM python:3.12-slim
RUN pip install --no-cache-dir Pillow==13.0.0
WORKDIR /app
COPY server.py /app/server.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 1024:100
CMD ["python", "/app/server.py"]
