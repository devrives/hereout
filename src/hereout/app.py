"""HereOut web server.

The server flattens the photo, asks the model for the marks and sends the
wall grid. The browser finds every route from that grid. A model call can take
minutes, and the proxy in front stops a request after about 100 s, so an upload
starts a job and the page asks for its answer. The server keeps the answer in
memory for a few minutes only. Nothing is written to disk.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import threading
import time
from collections import OrderedDict, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .gallery import Gallery
from .ink_walls import warm_text_models
from .pipeline import BadPhoto, answer, decode_photo, prepare, read_marks
from .reader import ModelClient

WEB = Path(__file__).parent / "web"
MAX_UPLOAD = 12 * 1024 * 1024
READS_PER_WINDOW = 12
OPENED_PLANS = 24
READ_WINDOW = 10 * 60
JOB_WORKERS = 4         # the model calls wait on the network, the wall pass on the one CPU
JOB_KEEP = 10 * 60      # seconds a job and its answer stay in memory
JOBS_HELD = 64
NO_STORE = {"Cache-Control": "no-store"}


def index_html() -> str:
    """index.html with a content hash on each /static/ file.

    The edge and the browsers keep static files for hours. A new hash makes
    them load the new file, so a page never runs with an old script.
    """
    def versioned(m: re.Match) -> str:
        digest = hashlib.sha256((WEB / m.group(2)).read_bytes()).hexdigest()[:10]
        return f'{m.group(1)}/static/{m.group(2)}?v={digest}"'
    return re.sub(r'((?:src|href)=")/static/([\w.-]+)"', versioned, (WEB / "index.html").read_text())


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


def client_ip(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")


class Jobs:
    """Uploads in work, by a random id. The answer stays until the page gets it
    or JOB_KEEP runs out. The oldest jobs go when more than JOBS_HELD are held."""

    def __init__(self, workers: int = JOB_WORKERS):
        self._pool = ThreadPoolExecutor(workers, thread_name_prefix="plan")
        self._jobs: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def start(self, work) -> str:
        jid = secrets.token_urlsafe(16)
        now = time.monotonic()
        with self._lock:
            for k in [k for k, j in self._jobs.items() if now - j["at"] > JOB_KEEP]:
                del self._jobs[k]
            while len(self._jobs) >= JOBS_HELD:
                self._jobs.popitem(last=False)
            self._jobs[jid] = {"at": now, "answer": None}
        self._pool.submit(self._run, jid, work)
        return jid

    def _run(self, jid: str, work) -> None:
        try:
            out = work()
        except Exception:  # one bad photo must not leave the page waiting
            out = {"error": "could not read this photo; try another photo"}
        with self._lock:
            if jid in self._jobs:
                self._jobs[jid]["answer"] = out

    def get(self, jid: str) -> tuple[bool, dict | None]:
        """(known, answer). The answer is None while the job works."""
        with self._lock:
            j = self._jobs.get(jid)
            if j is None or time.monotonic() - j["at"] > JOB_KEEP:
                return False, None
            return True, j["answer"]


def create_app(client: ModelClient | None = None, use_env: bool = True,
               gallery: Gallery | None = None) -> FastAPI:
    if client is None and use_env:
        client = ModelClient.from_env()
    if gallery is None and use_env and os.environ.get("HEREOUT_GALLERY"):
        gallery = Gallery(Path(os.environ["HEREOUT_GALLERY"]))
    app = FastAPI(title="HereOut", docs_url=None, redoc_url=None, openapi_url=None)
    if use_env:
        # Load the text models now, not in the first request (seconds on one CPU).
        threading.Thread(target=warm_text_models, daemon=True).start()
    reads = RateLimit(READS_PER_WINDOW, READ_WINDOW)
    jobs = Jobs()
    page = index_html()

    @app.api_route("/", methods=["GET", "HEAD"])
    def index():
        return HTMLResponse(page)

    @app.api_route("/robots.txt", methods=["GET", "HEAD"], response_class=PlainTextResponse)
    def robots():
        return "User-agent: *\nDisallow: /\n"

    @app.api_route("/favicon.ico", methods=["GET", "HEAD"])
    def favicon():
        return FileResponse(WEB / "favicon.ico", media_type="image/x-icon")

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
        allowed = reads.allow(client_ip(request))

        def work() -> dict:
            if allowed:
                reading, err = read_marks(plan, client)
            else:
                plan.no_reading()
                reading, err = None, "too many photos; mark the plan by hand"
            return answer(None, plan, reading, err)

        return JSONResponse({"job": jobs.start(work)}, status_code=202, headers=NO_STORE)

    @app.get("/api/plan/{jid}")
    def plan_answer(jid: str):
        known, out = jobs.get(jid)
        if not known:
            raise HTTPException(404, "the server no longer has this photo; send it again")
        if out is None:
            return JSONResponse({"working": True}, status_code=202, headers=NO_STORE)
        if "error" in out:
            raise HTTPException(500, out["error"], headers=NO_STORE)
        return JSONResponse(out, headers=NO_STORE)

    # A review set read with code under test, opened with "?set=review". It is a gallery
    # folder inside review/, so its thumbnails come from the /review/ mount.
    review_set = None
    if gallery and (gallery.folder / "review" / "gallery" / "items").is_dir():
        review_set = Gallery(gallery.folder / "review" / "gallery", "/review/gallery/thumbs")

    def pick(set: str | None) -> Gallery | None:
        return review_set if set == "review" else gallery

    @app.get("/api/gallery")
    def gallery_list(set: str | None = None):
        g = pick(set)
        return {"plans": g.listing() if g else []}

    # The last sample plans opened: the walls of one take seconds on one CPU.
    # They are open-licensed samples, not photos from users.
    opened: OrderedDict[tuple, dict] = OrderedDict()
    opened_lock = threading.Lock()

    @app.post("/api/gallery/{gid}")
    def gallery_open(gid: str, set: str | None = None):
        key = (set == "review", gid)
        with opened_lock:
            if key in opened:
                opened.move_to_end(key)
                return opened[key]
        g = pick(set)
        # An answer saved by scripts/save_answers.py with the current code.
        saved = g.saved_answer(gid) if g else None
        if saved is not None:
            return Response(saved, media_type="application/json")
        out = g.answer(gid) if g else None
        if out is None:
            raise HTTPException(404, "this sample plan is not available")
        with opened_lock:
            opened[key] = out
            while len(opened) > OPENED_PLANS:
                opened.popitem(last=False)
        return out

    app.mount("/static", StaticFiles(directory=WEB), name="static")
    if gallery:
        app.mount("/gallery/thumbs", StaticFiles(directory=gallery.folder / "thumbs"), name="thumbs")
        # Review pages for the owner, written outside the repository by test scripts.
        # robots.txt keeps them out of search.
        if (gallery.folder / "review").is_dir():
            app.mount("/review", StaticFiles(directory=gallery.folder / "review", html=True), name="review")
    return app


app = create_app()
