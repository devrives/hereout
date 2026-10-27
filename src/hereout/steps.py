"""Turn a route into short spoken steps.

Posted plans are drawn so that "up" on the plan is the way the reader faces
when they stand in front of it. So the first step is given relative to "up",
and each later step relative to the step before it.

The plan has no reliable scale, so lengths are relative: a short, medium or
long walk compared with the size of the plan.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

SIMPLIFY_SHARE = 0.015   # path points closer than this share of the plan to a line merge
MIN_LEG_SHARE = 0.03     # legs shorter than this share are folded into the next one


def simplify(points: list[tuple[float, float]], plan_size: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return list(points)
    curve = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
    approx = cv2.approxPolyDP(curve, SIMPLIFY_SHARE * plan_size, False).reshape(-1, 2)
    out = [tuple(map(float, p)) for p in approx]
    # Drop tiny legs, but always keep the start and the exit.
    kept = [out[0]]
    for p in out[1:-1]:
        if math.dist(kept[-1], p) >= MIN_LEG_SHARE * plan_size:
            kept.append(p)
    kept.append(out[-1])
    return kept


def _heading(a, b) -> float:
    """Angle in degrees, 0 = up on the plan, clockwise positive."""
    return math.degrees(math.atan2(b[0] - a[0], -(b[1] - a[1])))


def _turn(delta: float) -> str:
    delta = (delta + 180) % 360 - 180
    a = abs(delta)
    if a < 25:
        return "straight"
    side = "right" if delta > 0 else "left"
    if a < 60:
        return f"slight {side}"
    if a < 135:
        return side
    return "back"


def _length(d: float, plan_size: float) -> str:
    share = d / plan_size
    if share < 0.12:
        return "short"
    if share < 0.35:
        return "medium"
    return "long"


def directions(points: list[tuple[float, float]], plan_w: float, plan_h: float) -> list[dict]:
    """Return steps as dicts with kind, turn, length and text."""
    plan_size = math.hypot(plan_w, plan_h)
    pts = simplify(points, plan_size)
    steps: list[dict] = []
    prev = 0.0  # facing the plan = facing "up"
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        head = _heading(a, b)
        turn = _turn(head - prev)
        length = _length(math.dist(a, b), plan_size)
        if i == 0:
            if turn == "back":
                text = f"With the plan in front of you, turn around: a {length} walk."
            else:
                way = "ahead" if turn == "straight" else f"to your {turn.replace('slight ', '')}"
                text = f"With the plan in front of you, go {way}: a {length} walk."
        elif turn == "straight":
            text = f"Keep going straight: a {length} walk."
        elif turn == "back":
            text = f"Turn around and walk back: a {length} walk."
        else:
            text = f"Turn {turn}, then a {length} walk."
        steps.append({"kind": "walk", "turn": turn, "length": length, "text": text,
                      "from": a, "to": b})
        prev = head
    steps.append({"kind": "arrive", "text": "The exit is here.", "at": pts[-1]})
    return steps
