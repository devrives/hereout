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
MAIN_LEG_SHARE = 0.6     # legs of one way this share of a walk or more give the walk its heading
SAME_WAY = 10.0          # degrees: legs within this of each other go the same way
END_WAY_SHARE = 0.35     # with no main way, a walk starts and ends on legs of a way this share of it or more
SPLIT_PASSES = 4         # passes that split walks with a turn between their two ways
SIDE_STEP_SHARE = 0.02   # a straight walk that ends farther than this share of the plan to one side has a side step


def _line_gap(p, a, b) -> float:
    """Distance of p from the line through a and b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.sqrt(dx * dx + dy * dy)
    if n == 0:
        return math.dist(p[:2], a[:2])
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


def simplify(points: list[tuple[float, float]], plan_size: float) -> list[int]:
    """The indices of the route points that stay."""
    if len(points) < 3:
        return list(range(len(points)))
    out = _douglas_peucker([(float(x), float(y), i) for i, (x, y) in enumerate(points)], SIMPLIFY_SHARE * plan_size)
    # Drop tiny legs, but always keep the start and the exit.
    kept = [out[0]]
    for p in out[1:-1]:
        if math.dist(kept[-1][:2], p[:2]) >= MIN_LEG_SHARE * plan_size - 1e-9:
            kept.append(p)
    kept.append(out[-1])
    return [p[2] for p in kept]


def _heading(a, b) -> float:
    """Angle in degrees, 0 = up on the plan, clockwise positive."""
    return math.degrees(math.atan2(b[0] - a[0], -(b[1] - a[1])))


def _walk_headings(points, i: int, j: int) -> tuple:
    """The headings of the walk from route point i to route point j, as
    (where it starts, where it ends). Its legs that go the same way (within
    SAME_WAY degrees of each other) add up. When the legs of one way are
    MAIN_LEG_SHARE of the walk or more, both are the heading of the longest
    of them: a short side step does not tilt the walk, so a right angle after
    it stays a right angle. Else the walk starts on its first leg of a way
    with END_WAY_SHARE of the walk and ends on its last one, as on a side
    step of two equal legs. With no such way, both are the heading of the
    straight line. A third item is the route point where the walk must
    split, when two of its ways make a turn."""
    legs = [(math.dist(points[k], points[k + 1]), _heading(points[k], points[k + 1])) for k in range(i, j)]
    total = sum(d for d, _ in legs)
    ways = [sum(e for e, g in legs if abs((g - h + 180) % 360 - 180) <= SAME_WAY) for _, h in legs]
    best = -1
    for k, (d, _) in enumerate(legs):
        if best < 0 or ways[k] > ways[best] + 1e-9 or (abs(ways[k] - ways[best]) <= 1e-9 and d > legs[best][0]):
            best = k
    if best >= 0 and ways[best] > 0 and ways[best] >= MAIN_LEG_SHARE * total:
        return legs[best][1], legs[best][1]
    ends = [k for k, (d, _) in enumerate(legs) if d > 0 and ways[k] >= END_WAY_SHARE * total]
    if not ends:
        h = _heading(points[i], points[j])
        return h, h
    first, last = legs[ends[0]][1], legs[ends[-1]][1]
    # A turn between two of these ways is a step of its own: the walk splits
    # where the second way starts.
    for a, b in zip(ends, ends[1:]):
        if _turn(legs[b][1] - legs[a][1]) != "straight":
            return first, last, i + b
    return first, last


def _side_step(a, b, head: float, plan_size: float) -> str | None:
    """"left" or "right" when a walk from a to b with this heading ends to one
    side of its start line by more than SIDE_STEP_SHARE of the plan: a side
    step round a wall that the walk leaves out. Else None."""
    h = math.radians(head)
    right = (b[0] - a[0]) * math.cos(h) + (b[1] - a[1]) * math.sin(h)
    if abs(right) <= SIDE_STEP_SHARE * plan_size:
        return None
    return "right" if right > 0 else "left"


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
    points = [(float(x), float(y)) for x, y in points]
    idx = simplify(points, plan_size)
    for _ in range(SPLIT_PASSES):
        out = [idx[0]]
        for a, b in zip(idx, idx[1:]):
            w = _walk_headings(points, a, b)
            if len(w) == 3 and a < w[2] < b:
                out.append(w[2])
            out.append(b)
        if len(out) == len(idx):
            break
        idx = out
    pts = [points[i] for i in idx]
    steps: list[dict] = []
    prev = 0.0  # facing the plan = facing "up"
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        head, end = _walk_headings(points, idx[i], idx[i + 1])[:2]
        turn = _turn(head - prev)
        length = _length(math.dist(a, b), plan_size)
        if i == 0:
            text = f"Start toward the {_plan_side(head)} of the plan and walk a {length} way."
        elif turn == "straight":
            side = _side_step(a, b, head, plan_size)
            text = (f"Step {side}, then keep going straight for a {length} way." if side
                    else f"Keep going straight for a {length} way.")
        elif turn == "back":
            # The side step comes before the turn: its side is that of the way the walker still faces.
            side = _side_step(a, b, prev, plan_size)
            text = (f"Step {side}, then turn around and go back a {length} way." if side
                    else f"Turn around and go back a {length} way.")
        else:
            text = f"Turn {turn.replace('slight', 'slightly')} and walk a {length} way."
        steps.append({"kind": "walk", "turn": turn, "length": length, "text": text,
                      "from": a, "to": b, "path": points[idx[i]:idx[i + 1] + 1]})
        prev = end
    steps.append({"kind": "arrive", "text": "Then you reach the exit.", "at": pts[-1]})
    return steps
