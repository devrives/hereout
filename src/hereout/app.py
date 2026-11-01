"""HereOut web server.

The server flattens the photo, asks the model for the marks and sends the
wall grid. The browser finds every route from that grid. A model call can take
minutes, and the proxy in front stops a request after about 100 s, so an upload
starts a job and the page asks for its answer. The server keeps the answer in
memory for a few minutes only. Nothing is written to disk.
"""

from __future__ import annotations

import hashlib
import html
import mimetypes
import os
import re
import secrets
import threading
import time
from collections import OrderedDict, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .gallery import Gallery
from .ink_walls import warm_text_models
from .pipeline import BadPhoto, answer, decode_photo, prepare, read_marks, start_words
from .reader import ModelClient, ModelError, SpendCapReached
from .translate import LANGS, DiskCache, apply, cache_key, items_of, labels_of

WEB = Path(__file__).parent / "web"
MAX_UPLOAD = 12 * 1024 * 1024
READS_PER_WINDOW = 12
OPENED_PLANS = 24
READ_WINDOW = 10 * 60
JOB_WORKERS = 4         # the model calls wait on the network, the wall pass on the one CPU
JOB_KEEP = 10 * 60      # seconds a job and its answer stay in memory
JOBS_HELD = 64
NO_STORE = {"Cache-Control": "no-store"}
TRANSLATIONS_PER_WINDOW = 30  # translation calls (not cache hits) for each address in READ_WINDOW
WORDS_KEEP = 6 * 60 * 60  # seconds the words of a photo stay in memory, for a later change of language
WORDS_HELD = 256
# After the walls, a job waits this long for a text read that is not done. A
# later read reaches the page through /api/text: the plan never waits for it.
WORDS_GRACE = 2.0
mimetypes.add_type("image/webp", ".webp")  # the slim image has no mime.types
LONG_CACHE = "public, max-age=31536000, immutable"


def static_digest(name: str) -> str:
    return hashlib.sha256((WEB / name).read_bytes()).hexdigest()[:10]


def index_html() -> str:
    """index.html with a content hash on each /static/ file.

    The edge and the browsers keep a file with its hash for a year. A new hash
    makes them load the new file, so a page never runs with an old script.
    """
    def versioned(m: re.Match) -> str:
        return f'{m.group(1)}/static/{m.group(2)}?v={static_digest(m.group(2))}"'
    page = re.sub(r'((?:src|href)=")/static/([\w.-]+)"', versioned, (WEB / "index.html").read_text())
    # The catalogues of the plan card (web/i18n/), loaded by the page with this hash.
    h = hashlib.sha256()
    for p in sorted((WEB / "i18n").glob("*.json")):
        h.update(p.name.encode() + b"\0" + p.read_bytes())
    return page.replace('data-i18n=""', f'data-i18n="{h.hexdigest()[:10]}"', 1)


EXAMPLE_PHOTO = "/gallery/example-photo"  # in index.html: the server puts the URL of the saved image here
EXAMPLE_TAG = '<figure id="example" class="example" hidden'
EXAMPLE_CREDIT = '<figcaption id="example-credit" class="credit"></figcaption>'


def credit_html(c: dict, changes: list[str]) -> str:
    """The credit of a gallery photo, as the gallery gives it (app.js showCredit)."""
    def link(text: str, href: str) -> str:
        t = html.escape(text)
        return f'<a href="{html.escape(href)}" rel="noopener">{t}</a>' if href else t
    title = re.sub(r'"([^"]*)"', "\u2018\\1\u2019", c["title"])  # app.js quoted()
    out = (f"Photo: \u201c{html.escape(title)}\u201d by {html.escape(c['author'])}, "
           f"{link(c['licence'], c.get('licence_url', ''))}, {link('source', c.get('source_url', ''))}. "
           f"Changes: {html.escape(', '.join([*c.get('changes', []), *changes]))}.")
    if c.get("share_alike"):
        out += " The changed image is shared under the same licence."
    return out


def example_page(page: str, gallery: Gallery | None) -> str:
    """The start page with its example: the photo of one sample plan under the
    marks that HereOut drew on it (web/example-marks.webp, scripts/example_marks.mjs).
    The example goes while the gallery has no saved image of that plan for the
    current code (scripts/save_answers.py): a hidden image would still load."""
    m = re.search(EXAMPLE_TAG + r'[^>]* data-sample="([\w-]+)"', page)
    url = gallery.saved_image_url(m[1]) if m and gallery else None
    if not url:
        return re.sub(EXAMPLE_TAG + r".*?</figure>\n?", "", page, count=1, flags=re.S)
    credit = credit_html(gallery.items[m[1]]["credit"], ["cropped", "marks, escape map and route drawn on top"])
    return (page.replace(f'src="{EXAMPLE_PHOTO}"', f'src="{html.escape(url)}"', 1)
                .replace(EXAMPLE_TAG, EXAMPLE_TAG.removesuffix(" hidden"), 1)
                .replace(EXAMPLE_CREDIT, EXAMPLE_CREDIT.replace("></", f">{credit}</"), 1))


DEMO_TAG = '<section id="demo" class="demo" hidden'
DEMO_LINK = '<p id="demo-link"'
DEMO_CREDITS = '<ul id="demo-credits"></ul>'


def demo_page(page: str, folder: Path | None, gallery: Gallery | None) -> str:
    """The start page with the demo video, from a folder outside the repository
    (HEREOUT_VIDEO: demo.mp4, demo-poster.webp). The video goes while the folder
    has no demo.mp4, or the gallery has no credit for a plan photo in it."""
    m = re.search(DEMO_TAG + r'[^>]* data-samples="([\w,-]+)"', page)
    ids = m[1].split(",") if m else []
    if not (m and folder and (folder / "demo.mp4").is_file() and gallery
            and all(i in gallery.items for i in ids)):
        page = re.sub(DEMO_LINK + r".*?</p>\n?", "", page, count=1, flags=re.S)
        return re.sub(DEMO_TAG + r".*?</section>\n?", "", page, count=1, flags=re.S)

    def url(name: str) -> str:  # a new file gets a new URL at the edge
        st = (folder / name).stat()
        return f"/video/{name}?v={st.st_size:x}{int(st.st_mtime):x}"
    poster = f' poster="{url("demo-poster.webp")}"' if (folder / "demo-poster.webp").is_file() else ""
    credits = "".join(f"<li>{credit_html(gallery.items[i]['credit'], ['shown in a screen recording of HereOut'])}</li>"
                      for i in ids)
    return (page.replace('src="/video/demo.mp4"', f'src="{url("demo.mp4")}"{poster}', 1)
                .replace(DEMO_TAG, DEMO_TAG.removesuffix(" hidden"), 1)
                .replace(DEMO_CREDITS, DEMO_CREDITS.replace("></", f">{credits}</"), 1))


class LongCache(StaticFiles):
    """Files whose URL changes with their content: the edge and the browsers
    keep them for a year. With versioned, only a URL whose ?v= is the hash of
    the file now (index_html). A page from before a deploy can ask for an old
    hash: the new file must not stay under that URL."""

    def __init__(self, *args, versioned: bool = False, **kwargs):
        super().__init__(*args, **kwargs)
        self.versioned = versioned

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        if self.versioned:
            v = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("v", [""])[0]
            if not v or v != static_digest(str(Path(full_path).relative_to(WEB))):
                return response
        response.headers["Cache-Control"] = LONG_CACHE
        return response


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


class Words:
    """The words of the photo plans, by a random id: the plan text read, the
    exit labels and their translations. In memory only, like the jobs, but
    kept longer, so that a change of language works while the plan is open."""

    def __init__(self):
        self._items: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def new(self) -> str:
        tid = secrets.token_urlsafe(16)
        now = time.monotonic()
        with self._lock:
            for k in [k for k, w in self._items.items() if now - w["at"] > WORDS_KEEP]:
                del self._items[k]
            while len(self._items) >= WORDS_HELD:
                self._items.popitem(last=False)
            self._items[tid] = {"at": now, "done": False, "plan_text": None, "labels": [], "tr": {}}
        return tid

    def get(self, tid: str) -> dict | None:
        with self._lock:
            return self._items.get(tid)

    def update(self, tid: str, **fields) -> None:
        with self._lock:
            if tid in self._items:
                self._items[tid].update(fields)


def create_app(client: ModelClient | None = None, use_env: bool = True,
               gallery: Gallery | None = None, video: Path | None = None,
               text_cache: DiskCache | None = None) -> FastAPI:
    if client is None and use_env:
        client = ModelClient.from_env()
    if gallery is None and use_env and os.environ.get("HEREOUT_GALLERY"):
        gallery = Gallery(Path(os.environ["HEREOUT_GALLERY"]))
    if video is None and use_env and os.environ.get("HEREOUT_VIDEO"):
        video = Path(os.environ["HEREOUT_VIDEO"])
    app = FastAPI(title="HereOut", docs_url=None, redoc_url=None, openapi_url=None)
    if use_env:
        # Load the text models now, not in the first request (seconds on one CPU).
        threading.Thread(target=warm_text_models, daemon=True).start()
    reads = RateLimit(READS_PER_WINDOW, READ_WINDOW)
    translations = RateLimit(TRANSLATIONS_PER_WINDOW, READ_WINDOW)
    jobs = Jobs()
    words = Words()
    if text_cache is None:
        text_cache = DiskCache.from_env() if use_env else DiskCache(None)
    # One translation call at a time for each text and language; a second request waits for the first.
    text_locks = [threading.Lock() for _ in range(16)]
    page = index_html()

    @app.api_route("/", methods=["GET", "HEAD"])
    def index():
        return HTMLResponse(demo_page(example_page(page, gallery), video, gallery))

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
        tid = words.new()

        def work() -> dict:
            # The words on the plan: a second call on the same image, beside the main call.
            said = start_words(client, plan.image) if allowed else None
            if allowed:
                reading, err = read_marks(plan, client)
            else:
                plan.no_reading()
                reading, err = None, "too many photos; mark the plan by hand"
            out = answer(None, plan, reading, err)
            words.update(tid, labels=labels_of(out["exits"]))
            out["text_id"], out["plan_text"] = f"p-{tid}", None
            if said is None:
                words.update(tid, done=True)
                return out
            try:
                out["plan_text"] = said.result(timeout=WORDS_GRACE)
                words.update(tid, plan_text=out["plan_text"], done=True)
            except TimeoutError:
                out["text_pending"] = True
                said.add_done_callback(lambda f: words.update(tid, plan_text=f.result(), done=True))
            return out

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

    @app.get("/api/text/{tid}")
    def plan_words(tid: str, request: Request, lang: str = "en", set: str | None = None):
        """The words of a plan in one language: the plan text read, with a
        "text" in that language for each item, and the exit labels. tid is
        "g-<gallery id>" or the "p-<id>" of a photo answer (text_id)."""
        if lang not in LANGS:
            raise HTTPException(400, "this language is not supported")
        entry = None
        if tid.startswith("g-"):
            g = pick(set)
            item = g.items.get(tid[2:]) if g else None
            if item is None:
                raise HTTPException(404, "this sample plan is not available")
            plan_text, labels = item.get("plan_text"), labels_of(item["reading"].get("exits") or [])
        else:
            entry = words.get(tid[2:]) if tid.startswith("p-") else None
            if entry is None:
                raise HTTPException(404, "the server no longer has the words of this photo")
            if not entry["done"]:
                return JSONResponse({"working": True}, status_code=202, headers=NO_STORE)
            plan_text, labels = entry["plan_text"], entry["labels"]
        items = items_of(plan_text, labels)
        if lang == "en" or not items:
            return JSONResponse(apply(plan_text, labels, lang, {}), headers=NO_STORE)
        key = cache_key(items, lang, client.model if client else "")
        # Photo words stay in memory (nothing of a photo goes to disk); sample words in the disk cache.
        cached = (lambda: entry["tr"].get(lang)) if entry is not None else (lambda: text_cache.get(key))
        done = cached()
        if done is None:
            with text_locks[int(key[:4], 16) % len(text_locks)]:
                done = cached()
                if done is None:
                    if client is None:
                        raise HTTPException(503, "translation is not available now")
                    if not translations.allow(client_ip(request)):
                        raise HTTPException(429, "too many translations; try again in a few minutes")
                    try:
                        done, _ = client.translate(items, lang, LANGS[lang])
                    except SpendCapReached:
                        raise HTTPException(503, "translation is not available now")
                    except ModelError:
                        raise HTTPException(502, "the translation failed; try again")
                    if not done:
                        raise HTTPException(502, "the translation failed; try again")
                    # Only a whole answer is kept: a part answer is tried again next time.
                    if len(done) == len(items):
                        if entry is not None:
                            entry["tr"][lang] = done
                        else:
                            text_cache.put(key, done)
        return JSONResponse(apply(plan_text, labels, lang, done), headers=NO_STORE)

    app.mount("/static", LongCache(directory=WEB, versioned=True), name="static")
    # The demo video, made by the recorder in the hub (docs/hackathon-hereout-submission-*).
    if video and video.is_dir():
        app.mount("/video", StaticFiles(directory=video), name="video")
    if gallery:
        app.mount("/gallery/thumbs", StaticFiles(directory=gallery.folder / "thumbs"), name="thumbs")
        # The plan images of the saved answers: their names carry the key of the answer.
        if (gallery.folder / "answers").is_dir():
            app.mount("/gallery/answers", LongCache(directory=gallery.folder / "answers"), name="answers")
        # Review pages for the owner, written outside the repository by test scripts.
        # robots.txt keeps them out of search.
        if (gallery.folder / "review").is_dir():
            app.mount("/review", StaticFiles(directory=gallery.folder / "review", html=True), name="review")
    return app


app = create_app()
