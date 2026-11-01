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
SLANT_ANGLE = 50.0       # degrees: two ways this close that take turns are one slanted way drawn on the grid
SLANT_SHARE = 0.85       # those two ways are this share of the walk or more
SLANT_TURNS = 3          # and the walk changes between them this many times or more
STAIR_ANGLE = 90.0 + SAME_WAY  # degrees: two square ways that take turns in short legs are a slanted way too (_slanted)
STAIR_PART = 0.5         # in such a staircase, no leg is more than this share of its way
STAIR_EVEN = 0.25        # and the smaller way is this share of the two or more (a diagonal, not a walk with jogs)


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


def _walk_headings(points, i: int, j: int, plan_size: float) -> tuple:
    """The headings of the walk from route point i to route point j, as
    (where it starts, where it ends). Its legs that go the same way (within
    SAME_WAY degrees of each other) add up. A walk on a slanted staircase of
    two close ways (_slanted) has the heading of the straight line. When the
    legs of one way are MAIN_LEG_SHARE of the walk or more, both are the heading of the longest
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
    if best >= 0 and _slanted(legs, ways, best, total, MIN_LEG_SHARE * plan_size):
        h = _heading(points[i], points[j])
        return h, h
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


def _slanted(legs, ways, best: int, total: float, short: float) -> bool:
    """True when the legs of a walk take turns between two close ways (a
    slanted corridor drawn on the grid as a staircase of short legs). Its
    heading is then that of the straight line, with no turn and no side step.
    Two square ways (up to STAIR_ANGLE apart) count too when each of their
    legs is shorter than short (MIN_LEG_SHARE of the plan) and at most
    STAIR_PART of its way, and the smaller way is STAIR_EVEN of the two or
    more: the drawn lines are level and upright, so a diagonal corridor
    gives a staircase of right angles too small to be steps (judge review 3,
    DE-commons_000022). An L with a small jog has one long leg on a way, and
    a walk with small jogs has a small second way, so both keep their words."""
    near = lambda g, h: abs((g - h + 180) % 360 - 180) <= SAME_WAY
    a = legs[best][1]
    other = [k for k, (d, g) in enumerate(legs) if d > 0 and not near(g, a)]
    if not other:
        return False
    b = legs[max(other, key=lambda k: (ways[k], legs[k][0]))][1]
    way_b = sum(d for d, g in legs if near(g, b))
    apart = abs((b - a + 180) % 360 - 180)
    stair = way_b >= STAIR_EVEN * (ways[best] + way_b) and all(
        d < short and d <= STAIR_PART * (ways[best] if near(g, a) else way_b)
        for d, g in legs if near(g, a) or near(g, b))
    if apart > (STAIR_ANGLE if stair else SLANT_ANGLE) or ways[best] + way_b < SLANT_SHARE * total:
        return False
    seq = [0 if near(g, a) else 1 for d, g in legs if d > 0 and (near(g, a) or near(g, b))]
    return sum(p != q for p, q in zip(seq, seq[1:])) >= SLANT_TURNS


def _side_step(a, b, head: float, plan_size: float) -> str | None:
    """"left" or "right" when a walk from a to b with this heading ends to one
    side of its start line by more than SIDE_STEP_SHARE of the plan: a side
    step round a wall that the walk leaves out. Else None."""
    h = math.radians(head)
    right = (b[0] - a[0]) * math.cos(h) + (b[1] - a[1]) * math.sin(h)
    if abs(right) <= SIDE_STEP_SHARE * plan_size:
        return None
    return "right" if right > 0 else "left"


def _detour(points, i: int, j: int, head: float, plan_size: float) -> int | None:
    """The route point where a walk from point i to point j must split, when
    it goes more than SIDE_STEP_SHARE of the plan to one side of its start
    line and comes back: the last point out on that side. Else None."""
    h, lim = math.radians(head), SIDE_STEP_SHARE * plan_size
    a = points[i]
    off = [(p[0] - a[0]) * math.cos(h) + (p[1] - a[1]) * math.sin(h) for p in points[i:j + 1]]
    far = max(off, key=abs)
    if abs(off[-1]) > lim or abs(far) <= lim:
        return None
    return i + max(k for k, o in enumerate(off) if o * far > 0 and abs(o) > lim)


def _side_move(points, i: int, j: int, head: float, plan_size: float) -> int | None:
    """The route point where the side step of a walk from point i to point j
    starts: the last point from which the walk still goes more than
    SIDE_STEP_SHARE of the plan to the side where it ends, so the walk after
    it names the side step (two small jogs count as one). None when the walk
    has no side step."""
    h, lim = math.radians(head), SIDE_STEP_SHARE * plan_size
    a = points[i]
    off = [(p[0] - a[0]) * math.cos(h) + (p[1] - a[1]) * math.sin(h) for p in points[i:j + 1]]
    if abs(off[-1]) <= lim:
        return None
    return i + max(k for k, o in enumerate(off) if abs(off[-1] - o) > lim)


def _side_end(points, i: int, j: int, head: float, plan_size: float) -> int | None:
    """The first route point after point i that is more than SIDE_STEP_SHARE
    of the plan to one side of the line with this heading through point i,
    when it comes before point j and on the side where the walk ends. Else None."""
    h, lim = math.radians(head), SIDE_STEP_SHARE * plan_size
    a = points[i]
    off = [(p[0] - a[0]) * math.cos(h) + (p[1] - a[1]) * math.sin(h) for p in points[i:j + 1]]
    if abs(off[-1]) <= lim:
        return None
    k = next(k for k, o in enumerate(off) if o * off[-1] > 0 and abs(o) > lim)
    return i + k if 0 < k < len(off) - 1 else None


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
            w = _walk_headings(points, a, b, plan_size)
            # A walk that steps aside and back (round a wall) splits where it
            # is farthest out, so both side steps get words (a11y review).
            # A walk with a side step splits where the side step starts, so
            # the words give it in its place (ux and a11y reviews).
            split = w[2] if len(w) == 3 else _detour(points, a, b, w[0], plan_size)
            if split is None:
                split = _side_move(points, a, b, w[0], plan_size)
            if split is not None and a < split < b:
                out.append(split)
            out.append(b)
        if len(out) == len(idx):
            break
        idx = out
    steps: list[dict] = []
    prev = 0.0  # facing the plan = facing "up"
    i = 0
    while i < len(idx) - 1:
        a, b = points[idx[i]], points[idx[i + 1]]
        head, end = _walk_headings(points, idx[i], idx[i + 1], plan_size)[:2]
        turn = _turn(head - prev)
        if i > 0 and turn == "back":
            # A turn back round the end of a wall: the side step and the way
            # back are two turns to the same side, so the walk splits where
            # the side step ends.
            k = _side_end(points, idx[i], idx[i + 1], prev, plan_size)
            if k is not None:
                idx.insert(i + 1, k)
                continue
        length = _length(math.dist(a, b), plan_size)
        # A side step is at the start of its walk (the walk split there). The
        # first step names it in the plan frame, the others for the walker.
        aside = _side_step(a, b, head, plan_size)
        if i == 0:
            text = f"Start toward the {_plan_side(head)} of the plan and walk a {length} way."
            if aside:
                text = (f"Move over toward the {_plan_side(head + (90 if aside == 'right' else -90))} of the plan, "
                        f"then start toward the {_plan_side(head)} of the plan and walk a {length} way.")
        elif turn == "straight":
            text = (f"Step {aside}, then keep going straight for a {length} way." if aside
                    else f"Keep going straight for a {length} way.")
        elif turn == "back":
            # The side step comes before the turn: its side is that of the way the walker still faces.
            side = _side_step(a, b, prev, plan_size)
            text = (f"Step {side}, then turn around and go back a {length} way." if side
                    else f"Turn around and go back a {length} way.")
        else:
            text = (f"Turn {turn.replace('slight', 'slightly')}, step {aside}, then walk a {length} way." if aside
                    else f"Turn {turn.replace('slight', 'slightly')} and walk a {length} way.")
        steps.append({"kind": "walk", "turn": turn, "length": length, "text": text,
                      "from": a, "to": b, "path": points[idx[i]:idx[i + 1] + 1]})
        prev = end
        i += 1
    steps.append({"kind": "arrive", "text": "Then you reach the exit.", "at": points[idx[-1]]})
    return steps
