"""Serve the Clustal viewer and run explicitly requested DeepTMHMM jobs."""

from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from dataclasses import dataclass
from math import ceil
from pathlib import Path, PurePosixPath
from secrets import token_urlsafe
from threading import Lock
from time import monotonic
from typing import Callable
from urllib.parse import urlsplit
import os
import re
import subprocess
import sys
import tempfile

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
ASSETS = frozenset({
    "index.html", "alignment-viewer.js", "figure-export.js", "project.js",
    "tm-annotations.js", "tm-annotations.css", "prediction-client.js", "prediction-config.js", "alignment-report.js",
    "alignment-settings-report.js",
})
SEQUENCE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
PROTEIN = re.compile(r"[ACDEFGHIKLMNPQRSTVWYX]+")
OUTPUT_NAME = "predicted_topologies.3line"
OUTPUT_LIMIT = 300_000
WAITING_LIMIT = 2
PROVIDER_ERROR = "DeepTMHMM 服務未傳回可用的結果，請稍後重試。"
PROVIDER_TIMEOUT = "DeepTMHMM 預測逾時，請稍後再試或減少序列數量。"

type Records = list[dict[str, str]]
type Predictor = Callable[[Records], str]


def bounded_setting(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be an integer") from None
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def configured_origin() -> str:
    value = os.environ.get("PREDICTION_ALLOWED_ORIGIN", "").strip()
    if not value:
        return ""
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"} or not parsed.hostname
        or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
    ):
        raise ValueError("PREDICTION_ALLOWED_ORIGIN must be one HTTP(S) origin without a path")
    return value


def valid_records(payload, max_sequences: int, max_residues: int) -> Records:
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list) or not 1 <= len(records) <= max_sequences:
        raise ValueError(f"請提供 1 到 {max_sequences} 條蛋白質序列。")

    validated = []
    seen = set()
    residues = 0
    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict) or set(record) != {"id", "sequence"}:
            raise ValueError(f"第 {index} 條序列需要 id 和 sequence。")
        identifier, sequence = record["id"], record["sequence"]
        if not isinstance(identifier, str) or not SEQUENCE_ID.fullmatch(identifier):
            raise ValueError(f"第 {index} 條序列的 ID 格式有誤。")
        if identifier in seen:
            raise ValueError(f"第 {index} 條序列的 ID 重複。")
        if not isinstance(sequence, str) or not sequence:
            raise ValueError(f"第 {index} 條序列未提供胺基酸。")
        residues += len(sequence)
        if residues > max_residues:
            raise ValueError(f"序列總長度超過 {max_residues} 個胺基酸。")
        if not PROTEIN.fullmatch(sequence):
            raise ValueError(f"第 {index} 條序列須使用大寫標準胺基酸代碼或 X，並移除 gap。")
        validated.append({"id": identifier, "sequence": sequence})
        seen.add(identifier)
    return validated


class PredictionTimeout(Exception):
    pass


def predict_deeptmhmm(records: Records, timeout: int) -> str:
    fasta = "\n".join([f">{row['id']}\n{row['sequence']}" for row in records]) + "\n"
    # The provider client runs in its own process so network stalls can have a hard deadline.
    with tempfile.TemporaryDirectory(prefix="clustal-deeptmhmm-") as directory:
        try:
            reply = subprocess.run(
                [sys.executable, str(ROOT / "prediction_server.py"), "--provider-worker", str(timeout)],
                cwd=directory,
                input=fasta.encode("ascii"),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=timeout + 30,
                check=True,
            )
        except subprocess.TimeoutExpired:
            raise PredictionTimeout from None
    if not reply.stdout or len(reply.stdout) > OUTPUT_LIMIT:
        raise ValueError("Invalid DeepTMHMM output size")
    return reply.stdout.decode("utf-8", errors="strict")


def provider_worker(timeout: int) -> int:
    """Run the public BioLib SDK without relaying provider logs or exception payloads."""
    try:
        fasta = sys.stdin.buffer.read(300_001)
        if not fasta or len(fasta) > 300_000:
            return 1
        with redirect_stdout(sys.stderr):
            import biolib
            import logging

            for logger in ("biolib", "biolib_no_user_data"):
                logging.getLogger(logger).disabled = True
            deep_tmhmm = biolib.load("DTU/DeepTMHMM")
            result = deep_tmhmm.cli(
                args=["--fasta", "input.fasta"],
                files={"input.fasta": fasta},
                check=True,
                timeout=timeout,
            )
            files = result.list_output_files(path_filter=lambda path: PurePosixPath(path).name == OUTPUT_NAME)
            if len(files) != 1 or not 0 < files[0].length <= OUTPUT_LIMIT:
                return 1
            topology = files[0].get_data()
        if not 0 < len(topology) <= OUTPUT_LIMIT:
            return 1
        sys.stdout.buffer.write(topology)
        return 0
    except Exception:
        return 1


@dataclass
class Job:
    status: str = "queued"
    topology: str | None = None
    error: str | None = None
    finished_at: float | None = None


class JobLimit(Exception):
    pass


class PredictionJobs:
    def __init__(self, predict: Predictor, concurrency: int, per_hour: int, ttl: int):
        self.predict = predict
        self.max_pending = concurrency + WAITING_LIMIT
        self.per_hour = per_hour
        self.ttl = ttl
        self.pool = ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="deeptmhmm")
        self.lock = Lock()
        self.jobs: dict[str, Job] = {}
        self.submitted: deque[float] = deque()
        self.pending = 0

    def expire(self, now: float) -> None:
        stale = [
            job_id for job_id, job in self.jobs.items()
            if job.finished_at is not None and now >= job.finished_at + self.ttl
        ]
        for job_id in stale:
            del self.jobs[job_id]

    def submit(self, records: Records) -> str:
        with self.lock:
            now = monotonic()
            self.expire(now)
            while self.submitted and self.submitted[0] <= now - 3600:
                self.submitted.popleft()
            if self.pending >= self.max_pending:
                raise JobLimit("預測服務目前繁忙，請稍後重試。")
            if len(self.submitted) >= self.per_hour:
                raise JobLimit("此站預測服務已達每小時使用上限，請稍後重試。")

            job_id = token_urlsafe(24)
            job = Job()
            self.jobs[job_id] = job
            self.pending += 1
            self.submitted.append(now)
            self.pool.submit(self.run, job, records)
            return job_id

    def run(self, job: Job, records: Records) -> None:
        with self.lock:
            job.status = "running"
        topology = None
        error = None
        try:
            result = self.predict(records)
            if not isinstance(result, str) or not result.strip() or len(result.encode("utf-8")) > OUTPUT_LIMIT:
                raise ValueError("Invalid DeepTMHMM result")
            topology = result
        except PredictionTimeout:
            error = PROVIDER_TIMEOUT
        except Exception:
            error = PROVIDER_ERROR
        finally:
            with self.lock:
                job.status = "error" if error else "done"
                job.topology = topology
                job.error = error
                job.finished_at = monotonic()
                self.pending -= 1

    def read(self, job_id: str) -> dict[str, str] | None:
        with self.lock:
            self.expire(monotonic())
            job = self.jobs.get(job_id)
            if not job:
                return None
            if job.error is not None:
                return {"status": job.status, "error": job.error}
            if job.topology is not None:
                return {"status": job.status, "topology": job.topology}
            return {"status": job.status}


def create_app(predict: Predictor | None = None) -> Flask:
    max_sequences = bounded_setting("PREDICTION_MAX_SEQUENCES", 20, 1, 50)
    max_residues = bounded_setting("PREDICTION_MAX_RESIDUES", 20_000, 1, 100_000)
    concurrency = bounded_setting("PREDICTION_CONCURRENCY", 2, 1, 4)
    jobs_per_hour = bounded_setting("PREDICTION_JOBS_PER_HOUR", 12, 1, 60)
    job_ttl = bounded_setting("PREDICTION_JOB_TTL_SECONDS", 3600, 60, 3600)
    timeout = bounded_setting("PREDICTION_TIMEOUT_SECONDS", 300, 30, 1800)
    allowed_origin = configured_origin()
    if predict is None and os.environ.get("BIOLIB_TOKEN", "").strip():
        predict = lambda records: predict_deeptmhmm(records, timeout)
    jobs = PredictionJobs(predict, concurrency, jobs_per_hour, job_ttl) if predict else None

    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 2 * max_residues + 128 * max_sequences + 1024

    @app.after_request
    def response_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            if allowed_origin:
                response.vary.add("Origin")
                if request.headers.get("Origin") == allowed_origin:
                    response.headers["Access-Control-Allow-Origin"] = allowed_origin
                    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
                    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify(error="送出的資料大小超過限制。"), 413

    @app.errorhandler(404)
    @app.errorhandler(405)
    def missing_api_route(error):
        response = error.get_response()
        if request.path.startswith("/api/"):
            message = "找不到預測服務端點。" if error.code == 404 else "這個預測服務端點不支援此請求方法。"
            response.data = app.json.dumps({"error": message})
            response.content_type = "application/json"
        return response

    @app.get("/healthz")
    def health():
        return jsonify(status="ok")

    @app.get("/api/predictions")
    def prediction_limits():
        # The final job in a full queue can wait through this many execution batches.
        max_batches = ceil((concurrency + WAITING_LIMIT) / concurrency)
        wait_seconds = max_batches * (timeout + 30) + 30
        return jsonify(
            available=jobs is not None, maxSequences=max_sequences, maxResidues=max_residues,
            waitSeconds=wait_seconds,
        )

    @app.post("/api/predictions")
    def submit_prediction():
        if jobs is None:
            return jsonify(error="目前沒有啟用 DeepTMHMM 預測服務。"), 503
        if not request.is_json:
            return jsonify(error="預測請求必須使用 JSON。"), 415
        try:
            records = valid_records(request.get_json(silent=True), max_sequences, max_residues)
            job_id = jobs.submit(records)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        except JobLimit as error:
            return jsonify(error=str(error)), 429
        return jsonify(jobId=job_id), 202

    @app.get("/api/predictions/<job_id>")
    def prediction_status(job_id):
        job = jobs.read(job_id) if jobs is not None and re.fullmatch(r"[A-Za-z0-9_-]{32}", job_id) else None
        if job is None:
            return jsonify(error="查無此工作，或結果已過期。"), 404
        return jsonify(job)

    @app.get("/")
    @app.get("/<asset>")
    def site(asset="index.html"):
        if asset not in ASSETS:
            return "", 404
        return send_from_directory(ROOT, asset)

    return app


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "--provider-worker":
    raise SystemExit(provider_worker(int(sys.argv[2])))

app = create_app()
