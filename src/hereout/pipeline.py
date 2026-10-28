"""From photo bytes to a plan: flatten, read the exits, find walls. The browser finds the routes."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import cv2
import numpy as np

from .ink_walls import ink_walls, text_boxes
from .legend import drop_legend_exits
from .plan import rectify
from .reader import ModelClient, ModelError, Reading, SpendCapReached
from .wall_lines import plan_walls

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
    text: list = field(default_factory=list)  # the text boxes of the image

    @classmethod
    def of(cls, image: np.ndarray, plan_box=None, changes: list[str] | None = None, text: list | None = None,
           exits: list[dict] = ()) -> "Plan":
        text = text_boxes(image) if text is None else text
        walls, soft, drawn = find_walls(image, plan_box, text, exits)
        return cls(image, walls, changes or [], drawn, soft, text)

    def use_reading(self, reading: Reading) -> None:
        """Drop the exits in a legend, then find the walls again inside the box the model saw."""
        reading.exits = drop_legend_exits(self.image, self.text, reading.exits, reading.plan_box)
        self.walls, self.soft, self.drawn = find_walls(self.image, reading.plan_box, self.text, reading.exits)


def find_walls(image: np.ndarray, plan_box, text: list, exits=()) -> tuple[np.ndarray, np.ndarray, dict]:
    """The hard walls, the soft lines, and the wall lines to draw."""
    _, drawn = plan_walls(image, plan_box)
    walls, soft = ink_walls(image, plan_box, text, [(e["x"], e["y"]) for e in exits])
    return walls, soft, drawn


def decode_photo(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None or min(img.shape[:2]) < 64:
        raise BadPhoto("not a readable image")
    return img


def prepare(photo: np.ndarray) -> Plan:
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
    return Plan.of(flat, changes=changes)


def image_data_url(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def read_marks(plan: Plan, client: ModelClient | None) -> tuple[Reading | None, str | None]:
    if client is None:
        return None, "model not configured"
    try:
        reading = client.read_plan(plan.image)
    except SpendCapReached:
        return None, "spend cap reached"
    except ModelError as e:
        return None, str(e)
    plan.use_reading(reading)
    return reading, None
