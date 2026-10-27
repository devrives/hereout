"""HereOut web server.

Photos stay in memory for a short time so the user can correct the marks with
two taps. Nothing is written to disk.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict, defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .pipeline import BadPhoto, Plan, decode_photo, image_data_url, plan_route, prepare, read_marks
from .reader import ModelClient

WEB = Path(__file__).parent / "web"
MAX_UPLOAD = 12 * 1024 * 1024
PLAN_TTL = 15 * 60
MAX_PLANS = 64
READS_PER_WINDOW = 12
READ_WINDOW = 10 * 60


class PlanStore:
    def __init__(self):
        self._plans: OrderedDict[str, tuple[float, Plan]] = OrderedDict()
        self._lock = threading.Lock()

    def put(self, plan: Plan) -> str:
        pid = secrets.token_urlsafe(12)
        with self._lock:
            self._expire()
            self._plans[pid] = (time.monotonic(), plan)
            while len(self._plans) > MAX_PLANS:
                self._plans.popitem(last=False)
        return pid

    def get(self, pid: str) -> Plan | None:
        """Return the plan and restart its time limit, so the limit counts from the last use."""
        with self._lock:
            self._expire()
            item = self._plans.get(pid)
            if item is None:
                return None
            self._plans[pid] = (time.monotonic(), item[1])
            self._plans.move_to_end(pid)
            return item[1]

    def _expire(self):
        now = time.monotonic()
        for pid in [k for k, (t, _) in self._plans.items() if now - t > PLAN_TTL]:
            del self._plans[pid]


class RateLimit:
    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


class RouteRequest(BaseModel):
    id: str = Field(max_length=40)
    here: tuple[float, float]
    exits: list[tuple[float, float]] = Field(min_length=1, max_length=20)


def client_ip(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")


def create_app(client: ModelClient | None = None, use_env: bool = True) -> FastAPI:
    if client is None and use_env:
        client = ModelClient.from_env()
    app = FastAPI(title="HereOut", docs_url=None, redoc_url=None, openapi_url=None)
    store = PlanStore()
    reads = RateLimit(READS_PER_WINDOW, READ_WINDOW)

    @app.api_route("/", methods=["GET", "HEAD"])
    def index():
        return FileResponse(WEB / "index.html")

    @app.api_route("/robots.txt", methods=["GET", "HEAD"], response_class=PlainTextResponse)
    def robots():
        return "User-agent: *\nDisallow: /\n"

    @app.api_route("/api/health", methods=["GET", "HEAD"])
    def health():
        return {"ok": True, "model": client is not None}

    @app.post("/api/plan")
    async def new_plan(request: Request, photo: UploadFile = File(...)):
        data = await photo.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "photo is too large")
        try:
            plan = await run_in_threadpool(lambda: prepare(decode_photo(data)))
        except BadPhoto as e:
            raise HTTPException(400, str(e))
        pid = store.put(plan)
        h, w = plan.image.shape[:2]
        out = {"id": pid, "image": image_data_url(plan.image), "width": w, "height": h,
               "here": None, "exits": [], "route": None, "steps": [], "model_error": None}

        if reads.allow(client_ip(request)):
            # The model call takes 15 to 60 seconds; keep the event loop free.
            reading, err = await run_in_threadpool(read_marks, plan, client)
        else:
            reading, err = None, "too many photos; mark the plan by hand"
        out["model_error"] = err
        if reading:
            out["here"] = list(map(round, reading.you_are_here)) if reading.you_are_here else None
            out["exits"] = [{"x": round(e["x"]), "y": round(e["y"]), "label": e["label"]} for e in reading.exits]
            if reading.you_are_here and reading.exits:
                exits = [(e["x"], e["y"]) for e in reading.exits]
                out.update(await run_in_threadpool(plan_route, plan, reading.you_are_here, exits))
        return out

    @app.post("/api/route")
    def reroute(req: RouteRequest):
        plan = store.get(req.id)
        if plan is None:
            raise HTTPException(404, "This photo is no longer on the server. Take it again.")
        return plan_route(plan, req.here, list(req.exits))

    app.mount("/static", StaticFiles(directory=WEB), name="static")
    return app


app = create_app()
