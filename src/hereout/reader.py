"""Ask Muse Spark where "you are here" and the exits are.

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
# times cheaper than the default, and 29 of 30 "you are here" points stayed
# within 5 percent of the image side (with the zoomed second look).
DEFAULT_EFFORT = "low"
USER_AGENT = "HereOut/0.1 (+https://hereout.devrives.com/)"

# In the style of the Meta grounding examples (dev.meta.ai/docs/image-understanding):
# a direct request, {"x", "y"} points and an x_min..y_max box. Tested on gallery plans
# (wiki/decisions/exit-mark-check.md); the floor rule helped plans with more than one level.
PROMPT = """You are an object grounding expert. This is a photo of a posted evacuation plan (fire escape plan).
Point to these objects in the image:
- "you are here": the point where the reader of the plan stands. It is a dot, a star or a pin, often with text such as "You are here", "Vous etes ici", "Sie sind hier", "Standort", or the same in any language. When a label has a pointer, a tail or a line, point to where the pointer ends, not to the label.
- "final exit": the end of each escape route on this floor. That is a door in the outer wall of the building, or the door of a protected staircase. Escape arrows end there. Point just inside that door, on the floor of the building. When an exit sign stands at that door, point to the sign. Never point to the street, the pavement, the paper outside the building or the legend. Never point to the middle of an arrow or a corridor. A running-man sign along a corridor, with the route going on past it, is not a final exit.
Also give the bounding box of "floor drawing": the drawing of the floor itself, without the title, the legend, the text blocks and the small site map.
When the plan shows more than one floor, use only the floor with the "you are here" mark.
Do not miss any final exit.
The coordinates should be integers in the 0-1000 range of the whole image: x from the left edge, y from the top edge.
Answer with JSON only, in this format:
{"floor_drawing": {"x_min": <int>, "y_min": <int>, "x_max": <int>, "y_max": <int>}, "you_are_here": {"x": <int>, "y": <int>}, "final_exits": [{"x": <int>, "y": <int>, "label": "<short text>"}], "notes": "<one short sentence>"}
If you cannot find "you are here", give null for it."""


REFINE_CROP = 0.35  # side of the zoomed crop, as a share of the long side
REFINE_PROMPT = """This is a zoomed part of a posted evacuation plan. It shows the "you are here" mark (a dot, star or pin, or a label with a pointer or line, with text such as "You are here" in any language).
Give the exact point where the reader stands: the dot itself, or the end of the pointer or line, not the label text.
Coordinates are integers from 0 to 1000 of this crop: x from the left edge, y from the top edge.
Answer with JSON only: {"you_are_here": [x, y]} or {"you_are_here": null} when the mark is not in this crop."""


# The model can give a value a little outside 0 to 1000, for example 1001
# (Meta image understanding docs). Such a value is clamped; a larger miss is dropped.
GRID_SLACK = 10


def on_grid(v) -> float:
    v = float(v)
    if not (-GRID_SLACK <= v <= 1000 + GRID_SLACK):
        raise ValueError
    return min(1000.0, max(0.0, v))


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
    you_are_here: tuple[float, float] | None   # image pixels
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

    here = None
    yah = data.get("you_are_here")
    if isinstance(yah, dict):
        try:
            here = px(yah["x"], yah["y"])
        except (KeyError, TypeError, ValueError):
            here = None
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

    return Reading(here, exits, str(data.get("notes", ""))[:200], plan_box=box)


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
            timeout=httpx.Timeout(120.0, connect=10.0),
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

    def _ask(self, prompt: str, img: np.ndarray) -> tuple[str, float, dict]:
        """One call with one image. Returns the answer text, its cost and usage."""
        image_b64 = encode_image(img)
        # Worst case: a large image prompt plus every output token.
        reserve = self.prices.cost(6000, MAX_TOKENS)
        self.ledger.reserve(reserve)
        actual = 0.0
        try:
            body = {
                "model": self.model,
                "max_tokens": MAX_TOKENS,
                "temperature": 0,
                **({"reasoning_effort": self.effort} if self.effort else {}),
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ]}],
            }
            try:
                r = self.http.post(API_URL, json=body)
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
        text, cost, usage = self._ask(PROMPT, img)
        reading = parse_answer(text, w, h)
        reading.cost_usd, reading.usage = cost, usage
        if refine and reading.you_are_here is not None:
            try:
                point, extra = self.refine_here(img, reading.you_are_here)
            except (ModelError, SpendCapReached):
                point, extra = None, 0.0
            reading.cost_usd += extra
            if point is not None:
                reading.you_are_here = point
        return reading

    def refine_here(self, img: np.ndarray, guess: tuple[float, float]) -> tuple[tuple[float, float] | None, float]:
        """Look again at a zoomed crop around the first guess."""
        h, w = img.shape[:2]
        side = round(REFINE_CROP * max(h, w))
        x0 = int(min(max(0, guess[0] - side / 2), max(0, w - side)))
        y0 = int(min(max(0, guess[1] - side / 2), max(0, h - side)))
        crop = img[y0:y0 + side, x0:x0 + side]
        ch, cw = crop.shape[:2]
        text, cost, _ = self._ask(REFINE_PROMPT, crop)
        m = re.search(r"\{.*\}", text, re.S)
        try:
            p = json.loads(m.group(0)).get("you_are_here") if m else None
            x, y = on_grid(p[0]), on_grid(p[1])
        except (TypeError, ValueError, IndexError, json.JSONDecodeError):
            return None, cost
        return (x0 + x / 1000 * cw, y0 + y / 1000 * ch), cost
