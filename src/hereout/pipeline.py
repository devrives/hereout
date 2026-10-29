"""From photo bytes to a plan: flatten, read the exits, find walls. The browser finds the routes."""

from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import cv2
import numpy as np

from .ink_walls import ink_walls, text_boxes
from .legend import drop_legend_exits
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

    @classmethod
    def of(cls, image: np.ndarray, plan_box=None, changes: list[str] | None = None, text: list | None = None,
           exits: list[dict] = ()) -> "Plan":
        text = text_boxes(image) if text is None else text
        walls, soft, drawn, _ = find_walls(image, plan_box, text, exits)
        return cls(image, walls, changes or [], drawn, soft, text)

    @classmethod
    def of_reading(cls, image: np.ndarray, reading: Reading, text: list) -> "Plan":
        """The plan for a saved reading, with its walls found once."""
        plan = cls(image, np.zeros(image.shape[:2], bool), text=text)
        plan.use_reading(reading)
        return plan

    def use_reading(self, reading: Reading) -> None:
        """Drop the exits in a legend, then find the walls again inside the box
        the model saw. An exit off the drawing goes; one on the street moves
        to the building (ink_walls.place_exits)."""
        if self.text is None:
            self.text = text_boxes(self.image)
        exits = drop_legend_exits(self.image, self.text, reading.exits, reading.plan_box)
        # Walls found in an aerial photo are roofs and trees: the page shows
        # the exits and points to the printed route.
        self.photo_map = is_photo_map(self.image, reading.plan_box)
        if self.photo_map:
            self.walls, self.soft, self.drawn = np.ones(self.image.shape[:2], bool), None, {"lines": [], "blocks": []}
            reading.exits = exits
            return
        self.walls, self.soft, self.drawn, placed = find_walls(self.image, reading.plan_box, self.text, exits)
        reading.exits = [{**e, "x": p[0], "y": p[1]} for e, p in zip(exits, placed) if p is not None]

    def no_reading(self) -> None:
        """Find the walls with no reading, for marks that the user places by hand."""
        if self.text is None:
            self.text = text_boxes(self.image)
        self.walls, self.soft, self.drawn, _ = find_walls(self.image, None, self.text)


def find_walls(image: np.ndarray, plan_box, text: list, exits=()) -> tuple[np.ndarray, np.ndarray, dict, list]:
    """The hard walls, the soft lines, the wall lines to draw, and the exits
    as placed on the drawing (None for an exit that is not on it)."""
    strong = strong_ink(image, plan_box)
    _, drawn = plan_walls(image, plan_box, strong)
    walls, soft, placed = ink_walls(image, plan_box, text, [(e["x"], e["y"]) for e in exits], strong)
    return walls, soft, drawn, placed


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
           "exits": [], "grid": grid_payload(plan.walls, plan.soft), "walls": plan.drawn, "model_error": err,
           "photo_map": plan.photo_map}
    if reading:
        out["exits"] = [{"x": round(e["x"]), "y": round(e["y"]), "label": e["label"]} for e in reading.exits]
    return out


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
