"""HereOut web server.

The server flattens the photo, asks the model for the marks and sends the
wall grid. The browser finds every route from that grid, so the server keeps
nothing after it answers. Nothing is written to disk.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .gallery import Gallery
from .pipeline import BadPhoto, Plan, decode_photo, image_data_url, prepare, read_marks
from .reader import ModelClient, Reading
from .route import grid_payload

WEB = Path(__file__).parent / "web"
MAX_UPLOAD = 12 * 1024 * 1024
READS_PER_WINDOW = 12
READ_WINDOW = 10 * 60


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


def answer(pid: str | None, plan: Plan, reading: Reading | None, err: str | None) -> dict:
    """The response for a new plan: the flat image, the marks, the wall grid and the wall lines."""
    h, w = plan.image.shape[:2]
    out = {"id": pid, "image": image_data_url(plan.image), "width": w, "height": h,
           "exits": [], "grid": grid_payload(plan.walls, plan.soft), "walls": plan.drawn, "model_error": err}
    if reading:
        out["exits"] = [{"x": round(e["x"]), "y": round(e["y"]), "label": e["label"]} for e in reading.exits]
    return out


def create_app(client: ModelClient | None = None, use_env: bool = True,
               gallery: Gallery | None = None) -> FastAPI:
    if client is None and use_env:
        client = ModelClient.from_env()
    if gallery is None and use_env and os.environ.get("HEREOUT_GALLERY"):
        gallery = Gallery(Path(os.environ["HEREOUT_GALLERY"]))
    app = FastAPI(title="HereOut", docs_url=None, redoc_url=None, openapi_url=None)
    reads = RateLimit(READS_PER_WINDOW, READ_WINDOW)
    page = index_html()

    @app.api_route("/", methods=["GET", "HEAD"])
    def index():
        return HTMLResponse(page)

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
        if reads.allow(client_ip(request)):
            # The model call takes 15 to 60 seconds; keep the event loop free.
            reading, err = await run_in_threadpool(read_marks, plan, client)
        else:
            reading, err = None, "too many photos; mark the plan by hand"
        return await run_in_threadpool(answer, None, plan, reading, err)

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

    @app.post("/api/gallery/{gid}")
    def gallery_open(gid: str, set: str | None = None):
        g = pick(set)
        found = g.open(gid) if g else None
        if found is None:
            raise HTTPException(404, "this sample plan is not available")
        plan, reading, item = found
        out = answer(f"g-{gid}", plan, reading, None)
        out["credit"] = item["credit"]
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
