"""From photo bytes to a plan: flatten, read the exits, find walls. The browser finds the routes."""

from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import cv2
import numpy as np

from .ink_walls import ink_walls, text_boxes
from .legend import drop_legend_exits, drop_text_exits
from .photo_map import is_photo_map
from .plan import rectify
from .reader import ModelClient, ModelError, Reading, SpendCapReached
from .route import grid_payload
from .wall_lines import plan_walls
from .walls import strong_ink

WORK_SIDE = 1600  # every coordinate the client sees is in this image


class BadPhoto(Exception):
    pass


@dataclass
class Plan:
    image: np.ndarray
    walls: np.ndarray                  # the walls to route in
    changes: list[str] = field(default_factory=list)  # what was done to the photo
    drawn: dict = field(default_factory=dict)  # the walls to draw: straight lines and filled blocks
    soft: np.ndarray | None = None     # soft lines: door swings and dashes, passable at a cost
    text: list | None = None           # the text boxes of the image, once found
    photo_map: bool = False            # a route printed on an aerial photo: no walls, the exits only
    faded: np.ndarray | None = None    # the faded ends of walls among the walls (ink_walls.faded_ends)

    @classmethod
    def of(cls, image: np.ndarray, plan_box=None, changes: list[str] | None = None, text: list | None = None,
           exits: list[dict] = ()) -> "Plan":
        text = text_boxes(image) if text is None else text
        walls, soft, drawn, _, faded = find_walls(image, plan_box, text, exits)
        return cls(image, walls, changes or [], drawn, soft, text, faded=faded)

    @classmethod
    def of_reading(cls, image: np.ndarray, reading: Reading, text: list) -> "Plan":
        """The plan for a saved reading, with its walls found once."""
        plan = cls(image, np.zeros(image.shape[:2], bool), text=text)
        plan.use_reading(reading)
        return plan

    def use_reading(self, reading: Reading) -> None:
        """Drop the exits in a legend or a text block, then find the walls again
        inside the box the model saw. An exit off the drawing goes; one on the
        street moves to the building (ink_walls.place_exits)."""
        if self.text is None:
            self.text = text_boxes(self.image)
        given = list(reading.exits)
        exits = drop_legend_exits(self.image, self.text, given, reading.plan_box)
        legend = {id(e) for e in given} - {id(e) for e in exits}
        exits = drop_text_exits(self.image, self.text, exits)
        # Walls found in an aerial photo are roofs and trees: the page shows
        # the exits and points to the printed route.
        self.photo_map = is_photo_map(self.image, reading.plan_box)
        if self.photo_map:
            self.walls, self.soft, self.faded, self.drawn = np.ones(self.image.shape[:2], bool), None, None, {"lines": [], "blocks": []}
            placed = [(e["x"], e["y"]) for e in exits]
        else:
            self.walls, self.soft, self.drawn, placed, self.faded = find_walls(self.image, reading.plan_box, self.text, exits)
        reading.exits = [{**e, "x": p[0], "y": p[1]} for e, p in zip(exits, placed) if p is not None]
        # What the code did with each exit of the model, for the page (model_reading).
        at = {id(e): p for e, p in zip(exits, placed)}
        reading.given = given
        reading.code = [{"drop": "legend"} if id(e) in legend else {"drop": "text"} if id(e) not in at
                        else {"drop": "off"} if at[id(e)] is None else {"at": at[id(e)]} for e in given]

    def no_reading(self) -> None:
        """Find the walls with no reading, for marks that the user places by hand."""
        if self.text is None:
            self.text = text_boxes(self.image)
        self.walls, self.soft, self.drawn, _, self.faded = find_walls(self.image, None, self.text)


def find_walls(image: np.ndarray, plan_box, text: list, exits=()) -> tuple[np.ndarray, np.ndarray, dict, list, np.ndarray]:
    """The hard walls, the soft lines, the wall lines to draw, the exits
    as placed on the drawing (None for an exit that is not on it), and the
    faded ends among the hard walls."""
    strong = strong_ink(image, plan_box)
    _, drawn = plan_walls(image, plan_box, strong)
    walls, soft, placed, faded = ink_walls(image, plan_box, text, [(e["x"], e["y"]) for e in exits], strong)
    return walls, soft, drawn, placed, faded


def decode_photo(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None or min(img.shape[:2]) < 64:
        raise BadPhoto("not a readable image")
    return img


def prepare(photo: np.ndarray) -> Plan:
    """The flat plan image. read_marks finds the walls, after the reading."""
    flat, M = rectify(photo)
    changes = [] if np.allclose(M, np.eye(3)) else ["perspective corrected"]
    h, w = flat.shape[:2]
    f = min(1.0, WORK_SIDE / max(h, w))
    if f < 1.0:
        flat = cv2.resize(flat, (max(1, round(w * f)), max(1, round(h * f))), interpolation=cv2.INTER_AREA)
    if flat.shape[:2] != photo.shape[:2] and not changes:
        changes.append("resized")
    elif f < 1.0:
        changes.append("resized")
    return Plan(flat, np.zeros(flat.shape[:2], bool), changes)


def image_data_url(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def answer(pid: str | None, plan: Plan, reading: Reading | None, err: str | None) -> dict:
    """The response for a new plan: the flat image, the marks, the wall grid and the wall lines."""
    h, w = plan.image.shape[:2]
    out = {"id": pid, "image": image_data_url(plan.image), "width": w, "height": h,
           "exits": [], "grid": grid_payload(plan.walls, plan.soft, plan.faded), "walls": plan.drawn, "model_error": err,
           "photo_map": plan.photo_map}
    if reading:
        out["exits"] = [{"x": round(e["x"]), "y": round(e["y"]), "label": e["label"]} for e in reading.exits]
        out["read"] = model_reading(reading)
    return out


MOVED_PX = 1.0  # a smaller change of a point is rounding, not a move


def model_reading(reading: Reading) -> dict:
    """What the model gave and what came of it, for the page. For each exit of
    the model: its label and point, the zoom check on it ("zoom", "zoom_at"),
    and then either the number of the exit in "exits" ("exit", with
    "placed_at" when the code moved it) or why the code dropped it ("drop").
    "zoom" of the whole reading is None for a saved reading: no record of the check."""
    given = reading.given if reading.given is not None else reading.exits
    code = reading.code if reading.code is not None else [{"at": (e["x"], e["y"])} for e in given]
    trace = reading.trace if reading.trace is not None else [dict(e) for e in given]
    pt = lambda p: [round(p[0]), round(p[1])]
    rows, j, n = [], 0, 0
    for t in trace:
        row = {"label": str(t.get("label", "")), "at": pt((t["x"], t["y"]))}
        if t.get("zoom"):
            row["zoom"] = t["zoom"]
        last = (t["x"], t["y"])
        if t.get("zoom") == "moved":
            last = t["to"]
            row["zoom_at"] = pt(last)
        if t.get("zoom") != "dropped" and j < len(code):
            c = code[j]
            j += 1
            if "drop" in c:
                row["drop"] = c["drop"]
            else:
                row["exit"] = n
                n += 1
                if np.hypot(c["at"][0] - last[0], c["at"][1] - last[1]) > MOVED_PX:
                    row["placed_at"] = pt(c["at"])
        rows.append(row)
    box = [round(v) for v in reading.plan_box] if reading.plan_box else None
    return {"box": box, "zoom": reading.zoom, "exits": rows}


def read_marks(plan: Plan, client: ModelClient | None) -> tuple[Reading | None, str | None]:
    """Ask the model for the exits, then find the walls once, with the exits
    the model gives. The model call waits on the network, so the text boxes
    are found during the call."""
    if client is None:
        plan.no_reading()
        return None, "model not configured"
    reading, err = None, None
    with ThreadPoolExecutor(1) as pool:
        text = pool.submit(text_boxes, plan.image) if plan.text is None else None
        try:
            reading = client.read_plan(plan.image)
        except SpendCapReached:
            err = "spend cap reached"
        except ModelError as e:
            err = str(e)
        if text is not None:
            plan.text = text.result()
    if reading:
        plan.use_reading(reading)
    else:
        plan.no_reading()
    return reading, err
