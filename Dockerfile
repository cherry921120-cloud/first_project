FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements-prediction.txt ./
RUN pip install --no-cache-dir -r requirements-prediction.txt
RUN useradd --create-home --uid 10001 clustal

COPY prediction_server.py index.html alignment-viewer.js tm-annotations.js tm-annotations.css figure-export.js project.js prediction-config.js prediction-client.js ./
USER clustal
EXPOSE 8080
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads 4 --bind \"0.0.0.0:${PORT:-8080}\" prediction_server:app"]
