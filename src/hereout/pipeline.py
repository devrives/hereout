"""From photo bytes to a route: flatten, read, find walls, route, steps."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import cv2
import numpy as np

from .plan import rectify
from .reader import ModelClient, ModelError, Reading, SpendCapReached
from .route import NoRoute, find_route
from .steps import directions
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

    @classmethod
    def of(cls, image: np.ndarray, plan_box=None, changes: list[str] | None = None) -> "Plan":
        walls, drawn = plan_walls(image, plan_box)
        return cls(image, walls, changes or [], drawn)

    def use_reading(self, reading: Reading) -> None:
        """Find the walls again inside the box the model saw."""
        if reading.plan_box is not None:
            self.walls, self.drawn = plan_walls(self.image, reading.plan_box)


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


def plan_route(plan: Plan, here: tuple[float, float], exits: list[tuple[float, float]]) -> dict:
    h, w = plan.image.shape[:2]
    try:
        route = find_route(plan.walls, here, exits)
    except NoRoute as e:
        return {"route": None, "steps": [], "route_error": str(e)}
    return {
        "route": {"points": [list(map(round, p)) for p in route.points], "exit_index": route.exit_index},
        "steps": directions(route.points, w, h),
        "route_error": None,
    }


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
