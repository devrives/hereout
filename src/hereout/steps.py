"""Turn a route into short spoken steps.

Many posted plans are drawn so that "up" on the plan is the way the reader
faces, but not all of them. So the first step names a side of the plan
("toward the top of the plan"), not a side of the body. Each later step is a
turn relative to the step before it, which holds however the plan is turned.

The plan has no reliable scale, so lengths are relative: a short, medium or
long walk compared with the size of the plan.

web/route.js has the same steps in JS. Change both.
"""

from __future__ import annotations

import math

SIMPLIFY_SHARE = 0.015   # path points closer than this share of the plan to a line merge
MIN_LEG_SHARE = 0.03     # legs shorter than this share are folded into the next one


def _line_gap(p, a, b) -> float:
    """Distance of p from the line through a and b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.sqrt(dx * dx + dy * dy)
    if n == 0:
        return math.dist(p, a)
    return abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / n


def _douglas_peucker(points: list, eps: float) -> list:
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    todo = [(0, len(points) - 1)]
    while todo:
        lo, hi = todo.pop()
        far, far_i = -1.0, -1
        for i in range(lo + 1, hi):
            g = _line_gap(points[i], points[lo], points[hi])
            if g > far:
                far, far_i = g, i
        if far_i >= 0 and far > eps:
            keep[far_i] = True
            todo.append((lo, far_i))
            todo.append((far_i, hi))
    return [p for p, k in zip(points, keep) if k]


def simplify(points: list[tuple[float, float]], plan_size: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return list(points)
    out = [(float(x), float(y)) for x, y in _douglas_peucker(list(points), SIMPLIFY_SHARE * plan_size)]
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


def _plan_side(heading: float) -> str:
    h = heading % 360
    sides = ["top", "top right", "right", "bottom right", "bottom", "bottom left", "left", "top left"]
    return sides[int(((h + 22.5) % 360) // 45)]


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
            text = f"Start toward the {_plan_side(head)} of the plan and walk a {length} way."
        elif turn == "straight":
            text = f"Keep going straight for a {length} way."
        elif turn == "back":
            text = f"Turn around and go back a {length} way."
        else:
            text = f"Turn {turn.replace('slight', 'slightly')} and walk a {length} way."
        steps.append({"kind": "walk", "turn": turn, "length": length, "text": text,
                      "from": a, "to": b})
        prev = head
    steps.append({"kind": "arrive", "text": "Then you reach the exit.", "at": pts[-1]})
    return steps
