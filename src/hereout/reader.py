"""Ask Muse Spark where the exits are.

The model gives only the exits and the box of the floor drawing. The user sets the
start with a tap: "you are here" does not come from the model (owner, 2026-10-28).

Every model call goes through ModelClient, which keeps a spend ledger on disk
and refuses a call that could take the total over the cap. A spend notice from
the provider does not stop billing, so this cap is the real stop.
"""

from __future__ import annotations

import base64
import fcntl
import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import httpx
import numpy as np

API_URL = "https://inference.baseten.co/v1/chat/completions"
DEFAULT_MODEL = "meta-models/muse-spark-open-1026"
MAX_IMAGE_SIDE = 1600
MAX_TOKENS = 12000  # the model reasons first; the answer itself is short
# Low reasoning effort: on 30 gallery plans it was 1.9 times faster and 2.5
# times cheaper than the default, with the same points.
DEFAULT_EFFORT = "low"
USER_AGENT = "HereOut/0.1 (+https://hereout.devrives.com/)"

# In the style of the Meta grounding examples (dev.meta.ai/docs/image-understanding):
# a direct request, {"x", "y"} points and an x_min..y_max box. Tested on gallery plans
# (wiki/decisions/exit-mark-check.md). On a plan with several levels, every level gets its exits.
PROMPT = """You are an object grounding expert. This is a photo of a posted evacuation plan (fire escape plan).
Point to these objects in the image:
- "final exit": the end of each escape route on this floor. That is a door in the outer wall of the building, or the door of a protected staircase. Escape arrows end there. Point just inside that door, on the floor of the building. When an exit sign stands at that door, point to the sign. Never point to the street, the pavement, the paper outside the building or the legend. Never point to the middle of an arrow or a corridor. A running-man sign along a corridor, with the route going on past it, is not a final exit.
Also give the bounding box of "floor drawing": the drawing of the floor itself, without the title, the legend, the text blocks and the small site map.
When the plan shows more than one floor or level, point to the final exits of every floor. On a level with no exit to the outside, the stairs or escalators that lead up toward the exits are its final exits.
Do not miss any final exit.
The coordinates should be integers in the 0-1000 range of the whole image: x from the left edge, y from the top edge.
Answer with JSON only, in this format:
{"floor_drawing": {"x_min": <int>, "y_min": <int>, "x_max": <int>, "y_max": <int>}, "final_exits": [{"x": <int>, "y": <int>, "label": "<short text>"}], "notes": "<one short sentence>"}"""



# The model can give a value a little outside 0 to 1000, for example 1001
# (Meta image understanding docs). Such a value is clamped; a larger miss is dropped.
GRID_SLACK = 10


def on_grid(v) -> float:
    v = float(v)
    if not (-GRID_SLACK <= v <= 1000 + GRID_SLACK):
        raise ValueError
    return min(1000.0, max(0.0, v))


# A second look at exits that sit far from any route colour. On gallery plans these were
# the misplaced ones; exits on a sign or an arrow end were right, and a zoom on them made
# some worse (wiki/decisions/exit-mark-check.md).
ZOOM_GATE = 0.015      # suspect: the nearest green or red is farther than this share of the long side
ZOOM_CROP = 0.18       # side of each crop, as a share of the long side
ZOOM_SIDE = 448        # crops are sent at this side
ZOOM_GUTTER = 24
ZOOM_MAX_MOVE = 0.07   # a larger move is not used
MAX_IMAGES = 8         # Baseten refuses a request with more images
ZOOM_PER_SHEET = 4
ZOOM_MAX = (MAX_IMAGES - 1) * ZOOM_PER_SHEET
# The zoom call only moves exits a little. After a slow main call the user waits
# for the plan, so no zoom call (wiki/decisions/slow-reads.md).
ZOOM_SKIP_AFTER = 45.0  # seconds of the main call
ZOOM_TIMEOUT = 60.0
CALL_TIMEOUT = 120.0
MAIN_TRIES = 2  # a timeout or a 5xx answer gets one more try

ZOOM_PROMPT = """Image 1 is a photo of a posted evacuation plan (fire escape plan). The other images are sheets of zoomed parts of image 1, up to four on each sheet, each with its number in a black box. Each zoomed part is centred on a proposed final exit, marked with a small magenta cross.
A final exit is the end of an escape route on this floor: a door in the outer wall of the building, or the door of a protected staircase. Escape arrows end there. When an exit sign stands at that door, the sign marks it. A final exit is never on the street, the pavement, the paper outside the building or the legend, and never in the middle of an arrow or a corridor.
For each zoomed part, point to the final exit nearest to the cross: just inside the door, or the exit sign at that door. Use image 1 to see where the building and the legend are. If no final exit is in that zoomed part, give null.
Stay inside the zoomed part: never point to another part of the sheet.
The coordinates should be integers in the 0-1000 range of the whole sheet: x from its left edge, y from its top edge.
Answer with JSON only: {"exits": [{"n": 1, "sheet": 2, "x": <int>, "y": <int>}, {"n": 2, "sheet": 2, "point": null}]}, with one entry for each numbered part. "sheet" is the image number of its sheet."""


def suspect_exits(img: np.ndarray, exits: list[dict]) -> list[int]:
    """The exits far from any green or red mark (route band, arrow or exit sign), farthest first."""
    if not exits:
        return []
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    a = lab[..., 1] - 128
    a0 = float(np.median(a))  # the tint of the paper
    mark = ((a < a0 - 6) | (a > a0 + 14)).astype(np.uint8)
    mark = cv2.morphologyEx(mark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    dist = cv2.distanceTransform(1 - mark, cv2.DIST_L2, 5)
    h, w = img.shape[:2]
    far = ZOOM_GATE * max(h, w)
    d = [float(dist[min(h - 1, max(0, int(e["y"]))), min(w - 1, max(0, int(e["x"])))]) for e in exits]
    return sorted((i for i, v in enumerate(d) if v > far), key=lambda i: -d[i])[:ZOOM_MAX]


def zoom_sheets(crops: list[np.ndarray]) -> tuple[list[np.ndarray], list[tuple[int, int, int, int, int]]]:
    """Put up to four crops on each sheet, numbered from 1. For each crop: sheet, x, y, width, height."""
    sheets, where = [], []
    for k in range(0, len(crops), ZOOM_PER_SHEET):
        group = crops[k:k + ZOOM_PER_SHEET]
        cols, rows = (2 if len(group) > 1 else 1), (len(group) + 1) // 2
        cell = ZOOM_SIDE + ZOOM_GUTTER
        sheet = np.full((rows * cell + ZOOM_GUTTER, cols * cell + ZOOM_GUTTER, 3), 255, np.uint8)
        for j, c in enumerate(group):
            f = ZOOM_SIDE / max(c.shape[:2])
            c = cv2.resize(c, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
            tx, ty = ZOOM_GUTTER + (j % 2) * cell, ZOOM_GUTTER + (j // 2) * cell
            sheet[ty:ty + c.shape[0], tx:tx + c.shape[1]] = c
            label = str(k + j + 1)
            cv2.rectangle(sheet, (tx, ty), (tx + 22 + 12 * len(label), ty + 30), (0, 0, 0), -1)
            cv2.putText(sheet, label, (tx + 6, ty + 23), 0, 0.8, (255, 255, 255), 2)
            where.append((len(sheets), tx, ty, c.shape[1], c.shape[0]))
        sheets.append(sheet)
    return sheets, where


class SpendCapReached(Exception):
    pass


class ModelError(Exception):
    pass


@dataclass
class Prices:
    """US dollars per one million tokens."""
    input: float = 1.25
    output: float = 4.25

    def cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return (prompt_tokens * self.input + completion_tokens * self.output) / 1_000_000


class SpendLedger:
    """A JSON file with the total spent. Safe across threads and processes."""

    def __init__(self, path: Path, cap_usd: float):
        self.path = path
        self.cap = cap_usd
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)

    def _locked(self, fn):
        with self._lock, open(self.path, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                raw = f.read().strip()
                data = json.loads(raw) if raw else {"spent_usd": 0.0, "calls": 0, "reserved_usd": 0.0}
                result = fn(data)
                f.seek(0)
                f.truncate()
                json.dump(data, f)
                return result
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    def reserve(self, amount: float) -> None:
        def fn(d):
            if d["spent_usd"] + d.get("reserved_usd", 0.0) + amount > self.cap:
                raise SpendCapReached(f"spend cap {self.cap:.2f} USD reached")
            d["reserved_usd"] = d.get("reserved_usd", 0.0) + amount
        self._locked(fn)

    def settle(self, reserved: float, actual: float) -> None:
        def fn(d):
            d["reserved_usd"] = max(0.0, d.get("reserved_usd", 0.0) - reserved)
            d["spent_usd"] += actual
            d["calls"] = d.get("calls", 0) + 1
        self._locked(fn)

    def snapshot(self) -> dict:
        return self._locked(lambda d: dict(d))


@dataclass
class Reading:
    exits: list[dict] = field(default_factory=list)  # {"x", "y", "label"} in image pixels
    notes: str = ""
    cost_usd: float = 0.0
    usage: dict = field(default_factory=dict)
    plan_box: tuple[float, float, float, float] | None = None  # image pixels


def encode_image(img: np.ndarray) -> str:
    h, w = img.shape[:2]
    f = min(1.0, MAX_IMAGE_SIDE / max(h, w))
    if f < 1.0:
        img = cv2.resize(img, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise ModelError("could not encode image")
    return base64.b64encode(buf.tobytes()).decode()


def parse_answer(text: str, width: int, height: int) -> Reading:
    """Read the model's JSON and turn 0-1000 coordinates into pixels."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ModelError("no JSON in the answer")
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise ModelError(f"bad JSON in the answer: {e}") from e

    def px(x, y):
        return on_grid(x) / 1000 * width, on_grid(y) / 1000 * height

    exits = []
    for e in data.get("final_exits") or []:
        try:
            x, y = px(e["x"], e["y"])
        except (KeyError, TypeError, ValueError):
            continue
        exits.append({"x": x, "y": y, "label": str(e.get("label", ""))[:60]})

    box = None
    b = data.get("floor_drawing")
    if isinstance(b, dict):
        try:
            x0, y0 = px(b["x_min"], b["y_min"])
            x1, y1 = px(b["x_max"], b["y_max"])
            if x1 - x0 > 0.1 * width and y1 - y0 > 0.1 * height:
                box = (x0, y0, x1, y1)
        except (KeyError, TypeError, ValueError):
            pass

    return Reading(exits, str(data.get("notes", ""))[:200], plan_box=box)


class ModelClient:
    def __init__(self, api_key: str, ledger: SpendLedger, model: str = DEFAULT_MODEL,
                 prices: Prices | None = None, transport: httpx.BaseTransport | None = None,
                 effort: str | None = DEFAULT_EFFORT):
        if model.endswith("-contributor"):
            raise ValueError("contributor models send content to training; not allowed")
        self.model = model
        self.effort = effort
        self.ledger = ledger
        self.prices = prices or Prices()
        self.http = httpx.Client(
            timeout=httpx.Timeout(CALL_TIMEOUT, connect=10.0),
            headers={"Authorization": f"Api-Key {api_key}", "User-Agent": USER_AGENT},
            transport=transport,
        )

    @classmethod
    def from_env(cls) -> "ModelClient | None":
        key = os.environ.get("BASETEN", "").strip()
        if not key:
            return None
        ledger = SpendLedger(Path(os.environ.get("HEREOUT_LEDGER", ".cache/spend.json")),
                             float(os.environ.get("HEREOUT_SPEND_CAP_USD", "5")))
        prices = Prices(float(os.environ.get("HEREOUT_PRICE_IN", "1.25")),
                        float(os.environ.get("HEREOUT_PRICE_OUT", "4.25")))
        effort = os.environ.get("HEREOUT_EFFORT", DEFAULT_EFFORT) or None
        return cls(key, ledger, os.environ.get("HEREOUT_MODEL", DEFAULT_MODEL), prices, effort=effort)

    def _ask(self, prompt: str, *imgs: np.ndarray, timeout: float = CALL_TIMEOUT) -> tuple[str, float, dict]:
        """One call with one or more images. Returns the answer text, its cost and usage."""
        images = [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encode_image(i)}"}} for i in imgs]
        # Worst case: a large prompt for each image plus every output token.
        reserve = self.prices.cost(6000 * len(imgs), MAX_TOKENS)
        self.ledger.reserve(reserve)
        actual = 0.0
        try:
            body = {
                "model": self.model,
                "max_tokens": MAX_TOKENS,
                "temperature": 0,
                **({"reasoning_effort": self.effort} if self.effort else {}),
                "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, *images]}],
            }
            try:
                r = self.http.post(API_URL, json=body, timeout=httpx.Timeout(timeout, connect=10.0))
            except httpx.HTTPError as e:
                # A timeout can still be billed, so count the worst case.
                actual = reserve
                raise ModelError(f"request failed: {type(e).__name__}") from e
            if r.status_code != 200:
                raise ModelError(f"model API status {r.status_code}")
            data = r.json()
            usage = data.get("usage") or {}
            # Bill the worst case when the API does not report usage.
            actual = (self.prices.cost(usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))
                      if usage else reserve)
            choice = (data.get("choices") or [{}])[0]
            text = choice.get("message", {}).get("content") or ""
            if not text and choice.get("finish_reason") == "length":
                raise ModelError("the model used all its tokens before it answered")
            return text, actual, usage
        finally:
            self.ledger.settle(reserve, actual)

    def read_plan(self, img: np.ndarray, refine: bool = True) -> Reading:
        h, w = img.shape[:2]
        for attempt in range(MAIN_TRIES):
            start = time.monotonic()
            try:
                text, cost, usage = self._ask(PROMPT, img)
                break
            except ModelError as e:
                again = str(e).startswith("request failed") or str(e).startswith("model API status 5")
                if not again or attempt == MAIN_TRIES - 1:
                    raise
        took = time.monotonic() - start
        reading = parse_answer(text, w, h)
        reading.cost_usd, reading.usage = cost, usage
        if not refine or took > ZOOM_SKIP_AFTER:
            return reading
        suspects = suspect_exits(img, reading.exits)
        if suspects:
            try:
                reading.exits, extra = self.zoom_exits(img, reading.exits, suspects)
                reading.cost_usd += extra
            except (ModelError, SpendCapReached):
                pass
        return reading

    def zoom_exits(self, img: np.ndarray, exits: list[dict], suspects: list[int]) -> tuple[list[dict], float]:
        """Look again at crops around the suspect exits. Returns the exits after the look and its cost."""
        h, w = img.shape[:2]
        side = max(160, round(ZOOM_CROP * max(h, w)))
        crops = []
        for i in suspects:
            e = exits[i]
            x0 = int(min(max(0, e["x"] - side / 2), max(0, w - side)))
            y0 = int(min(max(0, e["y"] - side / 2), max(0, h - side)))
            c = img[y0:y0 + side, x0:x0 + side].copy()
            cv2.drawMarker(c, (int(e["x"] - x0), int(e["y"] - y0)), (255, 0, 255), cv2.MARKER_CROSS,
                           max(8, side // 14), max(1, side // 120))
            crops.append((c, x0, y0))
        sheets, where = zoom_sheets([c for c, _, _ in crops])
        text, cost, _ = self._ask(ZOOM_PROMPT, img, *sheets, timeout=ZOOM_TIMEOUT)
        m = re.search(r"\{.*\}", text or "", re.S)
        try:
            answers = {int(a["n"]): a for a in json.loads(m.group(0)).get("exits", [])} if m else {}
        except (json.JSONDecodeError, TypeError, ValueError, KeyError, AttributeError):
            answers = {}
        out = [dict(e) for e in exits]
        drop = set()
        for n, (i, (c, x0, y0), (sheet, tx, ty, tw, th)) in enumerate(zip(suspects, crops, where), 1):
            a = answers.get(n)
            if not isinstance(a, dict):
                continue
            if "x" not in a:
                if a.get("point", "") is None:
                    drop.add(i)  # the model sees no exit in this crop
                continue
            try:
                if int(a.get("sheet", sheet + 2)) != sheet + 2:
                    continue
                H, W = sheets[sheet].shape[:2]
                sx, sy = on_grid(a["x"]) / 1000 * W - tx, on_grid(a["y"]) / 1000 * H - ty
            except (TypeError, ValueError):
                continue
            if not (-5 <= sx <= tw + 5 and -5 <= sy <= th + 5):
                continue
            ch, cw = c.shape[:2]
            x, y = x0 + sx / tw * cw, y0 + sy / th * ch
            if np.hypot(x - exits[i]["x"], y - exits[i]["y"]) <= ZOOM_MAX_MOVE * max(h, w):
                out[i]["x"], out[i]["y"] = x, y
        kept = [e for i, e in enumerate(out) if i not in drop]
        return (kept or out), cost
