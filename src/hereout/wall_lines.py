"""Turn the wall mask into straight wall lines, and the lines into the walls to route in.

The wall mask holds walls, but also door swings, symbols, columns, text and
the edges of painted escape bands. Routes and the drawing of the walls are
simpler and cleaner with straight lines:

1. Opening with a horizontal and a vertical bar keeps the ink that runs
   straight. Each piece gets the line that fits its pixels best. A piece of
   at least MIN_SHARE of the plan is a wall. A shorter piece is a wall when
   it is on the line of a long wall, as the pieces of a wall between doors
   are. A piece much thicker than a wall is a filled block.
2. Dense ink over a large area (hatching, a filled room) is a filled block.
3. Long straight lines in the ink that is left are the diagonal walls (Hough).
4. Pieces on one line with a gap smaller than a door are one line, when
   the photo has ink in the gap. Blank paper there is a door.
5. A line or block much fainter than the usual wall line is the edge of a
   painted band or a light detail, not a wall. A line much more coloured
   than the usual wall line is a printed route or arrow, not a wall.
6. Four or more short parallel lines, evenly spaced and close together, are
   the treads of stairs. Stairs are a way out, so they are not walls.
7. Long, dark ink of one thin stroke that no line covers and no line runs
   beside is a wavy wall. The middle of the ink along its length gives one
   straight line, which stops where the ink stops (a door). A wavy wall that
   touches columns or door swings gives no line: a wrong wall across a door
   is worse than a missing one.

Each line grows a little at its ends where the photo has ink, so a corner
has no leak. The walls to route in are these lines, the blocks, and
everything outside the plan box.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from .walls import outside_box, stroke_width, wall_mask

MIN_SHARE = 0.025      # a wall line is at least this share of the longest image side
SHORT_SHARE = 0.008    # a shorter piece is a wall only on the line of a long wall (between doors)
ALIGN_SHARE = 0.15     # how far along that line the long wall can be
HATCH_SHARE = 0.03     # the window that finds dense ink (hatching, filled areas)
DENSE_INK = 0.3        # ink share in that window that makes a block
SOLID = 0.6            # a thick piece that fills this share of its rectangle is a block
THICK_WALLS = 3.0      # a piece thicker than this many strokes is a filled block
JOIN_SHARE = 0.006     # pieces on one line with a smaller gap are one wall (a door is wider)
INKED_GAP = 0.7        # a gap with ink at this share of its points is a break in the line, not a door
STAIR_STEPS = 4        # this many parallel lines close together are the treads of stairs
STAIR_SHARE = 0.012    # treads are closer than this share of the plan; rooms and stalls are wider
TREAD_SHARE = 0.08     # a tread is shorter than this share of the plan
BENT_SHARE = 0.05      # ink not straight but this long (share of the plan) can be a bent wall
BENT_WIDTH = 0.2       # a bent wall is thinner than this share of its length, and bends less
BENT_DARK = 0.7        # and its ink is at least this share of the usual wall darkness
BENT_SAT = 40          # and its ink is not much more coloured than the walls (HSV saturation, 0-255)
BENT_SOLID = 0.9       # and it has ink along at least this share of its length
BENT_INK = 2.5         # and it holds at most this many strokes of ink for its length
BESIDE_SHARE = 0.03    # a line this close (share of the plan) along most of it is the same wall
BESIDE_ANGLE = math.radians(12)  # and at most this far from parallel
ANGLE_TOL = math.radians(4)
FAINT_LINE = 0.6       # a line with less contrast than this share of the usual wall is not a wall
FAINT_BLOCK = 0.67     # the same for a block, with the darkest quarter of its pixels
COLOURED = 18.0        # a line this much more coloured than the usual wall (Lab chroma) is a printed route
PEAK_SIDE = 6          # px to each side of a line where its colour is compared
PEAK_MARGIN = 6.0      # a printed line is at most this much less coloured than its sides
SIDE_PX = 3            # look this far to each side of a line for its darkest ink
END_SHARE = 0.003      # each line grows at most this much at each end, over ink only
PAPER_SHARE = 1 / 40   # the closing that finds the paper colour, as in walls.py


def plan_walls(img: np.ndarray, plan_box=None, ink=None) -> tuple[np.ndarray, dict]:
    """The wall mask to route in, and the walls to draw: lines [x0, y0, x1, y1, width]
    and blocks (filled areas, as polygons). ink: walls.strong_ink(img, plan_box), when the caller has it."""
    lines, blocks = find_lines(img, wall_mask(img, plan_box, ink), plan_box)
    return draw_walls(lines, blocks, img.shape, plan_box), {"lines": lines, "blocks": blocks}


def find_lines(img: np.ndarray, walls: np.ndarray, plan_box=None) -> tuple[list[list[int]], list[list[list[int]]]]:
    h, w = img.shape[:2]
    side = max(h, w)
    ink = (walls & ~outside_box(walls.shape, plan_box)).astype(np.uint8)
    if ink.sum() < 50:
        return [], []
    stroke = max(1.5, stroke_width(ink, plan_box))
    min_len = max(12, round(MIN_SHARE * side))

    segs = []    # [x0, y0, x1, y1, width] as floats
    short = []   # pieces shorter than a wall line, kept when they are on the line of one
    blocks = []  # filled areas, as polygons
    # The bar is longer than a wall is thick, so a horizontal bar does not
    # fit across a vertical wall.
    short_len = max(6, round(SHORT_SHARE * side), round(2 * stroke) + 1)
    for bar in ((short_len, 1), (1, short_len)):
        mask = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, bar))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for k in range(1, n):
            x, y, bw, bh, _ = stats[k]
            ys, xs = np.nonzero(labels[y:y + bh, x:x + bw] == k)
            a, b, width = _fit(xs + x, ys + y)
            if width > THICK_WALLS * stroke:
                # A solid piece is a filled block. Any other thick piece is a
                # tangle of ink, not one wall.
                box = _box(xs + x, ys + y)
                if max(bw, bh) >= min_len and len(xs) >= SOLID * cv2.contourArea(np.array(box, np.float32)):
                    blocks.append(box)
                continue
            seg = [*a, *b, width]
            (segs if _length(seg) >= min_len else short).append(seg)
    segs += [p for p in short if _on_wall_line(p, segs, stroke, ALIGN_SHARE * side)]

    # Dense ink over a large area is hatching or a filled area: a block.
    k = max(5, round(HATCH_SHARE * side)) | 1
    dense = (cv2.boxFilter(ink.astype(np.float32), -1, (k, k)) > DENSE_INK).astype(np.uint8)
    dense = cv2.morphologyEx(dense, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dense, connectivity=8)
    for k2 in range(1, n):
        if min(stats[k2, cv2.CC_STAT_WIDTH], stats[k2, cv2.CC_STAT_HEIGHT]) >= min_len:
            ys, xs = np.nonzero(labels == k2)
            blocks.append(_box(xs, ys))

    # Diagonal walls: long straight lines in the ink that the pieces and
    # blocks above do not cover.
    covered = np.zeros_like(ink)
    for s in segs:
        cv2.line(covered, _pt(s[0], s[1]), _pt(s[2], s[3]), 1, int(max(3, s[4] + 4)))
    for bl in blocks:
        cv2.fillPoly(covered, [np.array(bl, np.int32)], 1)
    rest = (ink & (1 - covered)) * 255
    found = cv2.HoughLinesP(rest, 1, np.pi / 180, threshold=min_len, minLineLength=2 * min_len, maxLineGap=2)
    for xa, ya, xb, yb in ([] if found is None else found.reshape(-1, 4)):
        ang = abs(math.degrees(math.atan2(yb - ya, xb - xa))) % 90
        if 10 < ang < 80:
            segs.append([float(xa), float(ya), float(xb), float(yb), stroke])
    # A line inside a block is part of the block.
    inside = np.zeros_like(ink)
    for bl in blocks:
        cv2.fillPoly(inside, [np.array(bl, np.int32)], 1)
    segs = [s for s in segs if not inside[int((s[1] + s[3]) / 2), int((s[0] + s[2]) / 2)]]

    segs = _join([s for s in segs if _length(s) >= min_len / 2], JOIN_SHARE * side, ink, stroke)
    segs = [s for s in segs if _length(s) >= min_len]
    contrast = _contrast(img)
    segs, blocks, usual = _drop_faint(contrast, segs, blocks)
    segs = _drop_coloured(img, contrast, segs)
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 1]
    segs += _bent_walls(ink, contrast, sat, segs, blocks, usual, stroke, min_len, side)

    segs = _drop_stairs(segs, side)
    segs = [_grow(s, ink, END_SHARE * side) for s in segs]
    lines = [[round(v) for v in s[:4]] + [max(1, round(s[4]))] for s in segs]
    return lines, [[[round(x), round(y)] for x, y in b] for b in blocks]


def draw_walls(lines: list[list[int]], blocks: list[list[list[int]]], shape, plan_box=None) -> np.ndarray:
    h, w = shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for b in blocks:
        cv2.fillPoly(mask, [np.array(b, np.int32)], 1)
    for x0, y0, x1, y1, width in lines:
        cv2.line(mask, _pt(x0, y0), _pt(x1, y1), 1, max(2, width))
    return mask.astype(bool) | outside_box(shape, plan_box)


def _pt(x, y):
    return int(round(x)), int(round(y))


def _length(s) -> float:
    return math.hypot(s[2] - s[0], s[3] - s[1])


def _fit(xs: np.ndarray, ys: np.ndarray):
    """The ends of the line through the pixels, and the mean width across it."""
    pts = np.stack([xs, ys], 1).astype(float)
    c = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    d = vt[0]
    t = (pts - c) @ d
    return c + d * t.min(), c + d * t.max(), len(pts) / max(1.0, t.max() - t.min())


def _box(xs: np.ndarray, ys: np.ndarray) -> list[list[float]]:
    """The smallest turned rectangle around the pixels, as four corners."""
    return cv2.boxPoints(cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))).tolist()


def _frame(walls) -> tuple[np.ndarray, ...]:
    """For each wall: start, unit direction and length, as arrays."""
    w = np.asarray(walls, float).reshape(-1, 5)
    d = w[:, 2:4] - w[:, :2]
    ln = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)
    return w[:, :2], d / ln[:, None], ln


def _relation(p, walls, tol: float = ANGLE_TOL):
    """For piece p and each wall: is it parallel, its offset from the wall
    line, and the span of p along the wall."""
    start, u, ln = _frame(walls)
    lp = max(_length(p), 1e-9)
    pd = np.array([p[2] - p[0], p[3] - p[1]]) / lp
    parallel = np.abs(u[:, 0] * pd[1] - u[:, 1] * pd[0]) <= math.sin(tol)
    ends = np.array([p[:2], p[2:4]], float)
    rel = ends[None, :, :] - start[:, None, :]                      # wall, end, xy
    along = rel[:, :, 0] * u[:, None, 0] + rel[:, :, 1] * u[:, None, 1]
    across = np.abs(rel[:, :, 0] * -u[:, None, 1] + rel[:, :, 1] * u[:, None, 0])
    return parallel, across.max(1), along.min(1), along.max(1), ln


def _on_wall_line(p, walls, stroke: float, reach: float) -> bool:
    """Is piece p on the line of a long wall, near enough along it?"""
    if not walls:
        return False
    parallel, off, lo, hi, ln = _relation(p, walls)
    ok = parallel & (off <= max(3.0, 2 * stroke)) & (lo - ln <= reach) & (-hi <= reach)
    return bool(ok.any())


def _join(segs: list[list[float]], gap: float, ink: np.ndarray, stroke: float) -> list[list[float]]:
    """Join pieces on one line whose gap is at most gap, until none is left.
    A gap longer than a stroke is joined only when the photo has ink in it:
    blank paper between two pieces is a door, not a break in the line."""
    segs = [list(map(float, s)) for s in segs]
    joined = True
    while joined:
        joined = False
        out: list[list[float]] = []
        for b in sorted(segs, key=_length, reverse=True):
            if out:
                parallel, off, lo, hi, ln = _relation(b, out)
                widths = np.array([a[4] for a in out])
                ok = parallel & (off <= np.maximum(3.0, widths + b[4])) & (lo - ln <= gap) & (-hi <= gap)
                hit = [int(i) for i in np.flatnonzero(ok)]
                start, u, _ = _frame(out)
                for i in hit:
                    t0, t1 = (ln[i], lo[i]) if lo[i] > ln[i] else (hi[i], 0.0)
                    if t1 - t0 <= stroke or _inked(ink, start[i] + u[i] * t0, start[i] + u[i] * t1) >= INKED_GAP:
                        break
                else:
                    hit = []
                if hit:
                    a = out[i]
                    start, u, _ = _frame([a])
                    t0, t1 = min(0.0, lo[i]), max(ln[i], hi[i])
                    out[i] = [*(start[0] + u[0] * t0), *(start[0] + u[0] * t1), max(a[4], b[4])]
                    joined = True
                    continue
            out.append(b)
        segs = out
    return segs


def _bent_walls(ink, contrast, sat, segs, blocks, usual, stroke, min_len, side) -> list[list[float]]:
    """Lines for the walls that are not straight (a wavy wall): long, dark ink
    of one thin stroke that no line covers and no line runs beside. Along its
    length, the middle of the ink gives one straight line. Where the ink
    stops (a door), the line stops too."""
    covered = np.zeros_like(ink)
    for s in segs:
        cv2.line(covered, _pt(s[0], s[1]), _pt(s[2], s[3]), 1, int(max(3, s[4] + 4)))
    for bl in blocks:
        cv2.fillPoly(covered, [np.array(bl, np.int32)], 1)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink & (1 - covered), connectivity=8)
    out = []
    step = max(4.0, 3 * stroke)
    wall_sat = float(np.median(sat[covered > 0])) if covered.any() else 0.0
    for k in range(1, n):
        x, y, bw, bh, _ = stats[k]
        if max(bw, bh) < BENT_SHARE * side:
            continue
        ys, xs = np.nonzero(labels[y:y + bh, x:x + bw] == k)
        if np.median(contrast[ys + y, xs + x]) < BENT_DARK * usual:
            continue
        # Signs and symbols are more coloured than the walls of the plan.
        if np.median(sat[ys + y, xs + x]) > wall_sat + BENT_SAT:
            continue
        pts = np.stack([xs + x, ys + y], 1).astype(float)
        c = pts.mean(0)
        _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
        d, nrm = vt[0], np.array([-vt[0][1], vt[0][0]])
        t, o = (pts - c) @ d, (pts - c) @ nrm
        span = t.max() - t.min()
        # One thin stroke: little ink for its length, and most of it within
        # a share of its length across. Columns, door swings and dashed lines
        # packed together hold much more ink.
        if len(xs) > BENT_INK * stroke * span:
            continue
        if np.percentile(o, 90) - np.percentile(o, 10) > BENT_WIDTH * span:
            continue
        if _beside(c, d, t.min(), t.max(), segs, side):
            continue
        run = []
        for t0 in np.arange(t.min(), t.max() + step, step):
            sel = (t >= t0) & (t < t0 + step)
            mid = float(np.median(o[sel])) if sel.any() else 0.0
            # A wall here has ink all along the bin near its middle line. A
            # dashed line, a grid or a row of symbols has gaps.
            if sel.any() and _solid(t[sel], o[sel], mid, t0, step, stroke):
                run.append(c + d * (t0 + step / 2) + nrm * mid)
            else:
                out += _poly(run, stroke, side)
                run = []
        out += _poly(run, stroke, side)
    return [s for s in out if _length(s) >= min_len / 2]


def _solid(t, o, mid, t0, step, stroke) -> bool:
    """Is there ink near the middle line all along this bin?"""
    near = np.abs(o - mid) <= 1.5 * stroke
    cover = np.zeros(int(step) + 1, bool)
    cover[np.clip((t[near] - t0).astype(int), 0, int(step))] = True
    return cover[:int(step)].mean() >= BENT_SOLID


def _beside(c, d, t0, t1, segs, side) -> bool:
    """Does a line run beside the ink from c + d * t0 to c + d * t1 for at
    least half of its length?"""
    if not segs:
        return False
    piece = [*(c + d * t0), *(c + d * t1), 0.0]
    parallel, off, lo, hi, ln = _relation(piece, segs, BESIDE_ANGLE)
    seen = np.zeros(int(t1 - t0) + 1, bool)
    for i in np.flatnonzero(parallel & (off <= BESIDE_SHARE * side)):
        a = segs[i]
        ends = sorted(float((np.array(p) - (c + d * t0)) @ d) for p in (a[:2], a[2:4]))
        lo_i, hi_i = max(0, int(ends[0])), min(len(seen) - 1, int(ends[1]))
        if hi_i > lo_i:
            seen[lo_i:hi_i + 1] = True
    return seen.mean() >= 0.5


def _poly(run, stroke, side) -> list[list[float]]:
    """The straight line that fits the points of run best: a wall with
    columns or a wavy wall is one wall. A run that bends far from the line
    between its ends is an arc (a door swing), not a wall."""
    if len(run) < 2:
        return []
    a, b = run[0], run[-1]
    chord = max(math.hypot(b[0] - a[0], b[1] - a[1]), 1e-9)
    if max(_line_gap(p, a, b) for p in run) > BENT_WIDTH * chord:
        return []
    ends = _fit(np.array([p[0] for p in run]), np.array([p[1] for p in run]))
    return [[*map(float, ends[0]), *map(float, ends[1]), stroke]]


def _line_gap(p, a, b) -> float:
    """The distance from point p to the line through a and b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    if n == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    return abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / n


def _drop_stairs(segs: list[list[float]], side: float) -> list[list[float]]:
    """Remove the treads of stairs: groups of parallel lines side by side,
    each close to the next, that look like treads. Stairs are a way out,
    not a wall."""
    n = len(segs)
    if n < STAIR_STEPS:
        return segs
    near = [[] for _ in range(n)]
    for i, a in enumerate(segs):
        others = [segs[j] for j in range(i + 1, n)]
        if not others:
            break
        parallel, off, lo, hi, ln = _relation(a, others)
        la = _length(a)
        # Side by side: parallel, close, and each along most of the other.
        overlap = np.minimum(hi, ln) - np.maximum(lo, 0)
        ok = parallel & (off <= STAIR_SHARE * side) & (overlap >= 0.6 * np.minimum(la, ln))
        for k in np.flatnonzero(ok):
            j = i + 1 + int(k)
            near[i].append(j)
            near[j].append(i)
    group = [-1] * n
    out = []
    for s0 in range(n):
        if group[s0] >= 0:
            continue
        todo, members = [s0], []
        group[s0] = s0
        while todo:
            i = todo.pop()
            members.append(i)
            for j in near[i]:
                if group[j] < 0:
                    group[j] = s0
                    todo.append(j)
        treads = _treads([segs[i] for i in members], side)
        out += [segs[i] for k, i in enumerate(members) if k not in treads]
    return out


def _treads(group: list[list[float]], side: float) -> set[int]:
    """Which of these parallel lines are the treads of stairs? Treads are
    short, at STAIR_STEPS or more evenly spaced places across the stairs,
    each close to the next. A long wall beside them is not a tread, and two
    lines at almost one place (the faces of one stroke) are one."""
    short = [k for k, g in enumerate(group) if _length(g) <= TREAD_SHARE * side]
    if len(short) < STAIR_STEPS:
        return set()
    # A tread that spans two flights side by side is longer than the others,
    # up to a few times the shortest tread.
    least = min(_length(group[k]) for k in short)
    treads = [k for k in short if _length(group[k]) <= 3 * least]
    start, u, _ = _frame([group[treads[0]]])
    normal = np.array([-u[0][1], u[0][0]])
    offsets = sorted(float((np.array(group[k][:2]) - start[0]) @ normal) for k in treads)
    places = [offsets[0]]
    for o in offsets[1:]:
        if o - places[-1] > 0.003 * side:
            places.append(o)
    if len(places) < STAIR_STEPS:
        return set()
    # Treads are evenly spaced: most gaps are near the usual gap. The faces
    # of a stall wall and the wall beside it are not.
    gaps = np.diff(places)
    mid = float(np.median(gaps))
    even = np.mean((gaps >= 0.5 * mid) & (gaps <= 2.0 * mid))
    return set(treads) if even >= 0.75 else set()


def _inked(ink: np.ndarray, p, q) -> float:
    """The share of the points from p to q that have ink within a pixel."""
    h, w = ink.shape
    n = max(2, int(math.hypot(q[0] - p[0], q[1] - p[1])) + 1)
    xs, ys = np.linspace(p[0], q[0], n), np.linspace(p[1], q[1], n)
    near = np.zeros(n, bool)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            near |= ink[np.clip(np.round(ys + dy).astype(int), 0, h - 1), np.clip(np.round(xs + dx).astype(int), 0, w - 1)] > 0
    return float(near.mean())


def _grow(s: list[float], ink: np.ndarray, most: float) -> list[float]:
    """Make each end of line s longer while the photo has ink there, by at
    most most pixels, so a wall meets the wall at its corner. Into blank
    paper (a door) it does not grow."""
    ln = max(_length(s), 1e-9)
    ux, uy = (s[2] - s[0]) / ln, (s[3] - s[1]) / ln
    h, w = ink.shape
    ends = []
    for (x, y), sign in (((s[0], s[1]), -1), ((s[2], s[3]), 1)):
        k = 0
        while k < most:
            nx, ny = x + sign * ux * (k + 1), y + sign * uy * (k + 1)
            if not (0 <= nx < w and 0 <= ny < h):
                break
            # Ink within a pixel of the point, rounded as in _inked.
            rows = [min(max(int(np.round(ny + d)), 0), h - 1) for d in (-1, 0, 1)]
            cols = [min(max(int(np.round(nx + d)), 0), w - 1) for d in (-1, 0, 1)]
            if not ink[np.ix_(rows, cols)].any():
                break
            k += 1
        ends.append((x + sign * ux * k, y + sign * uy * k))
    return [*ends[0], *ends[1], s[4]]


def _contrast(img: np.ndarray) -> np.ndarray:
    """How much darker each pixel is than the paper around it."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    k = max(15, int(max(h, w) * PAPER_SHARE) | 1)
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    return paper.astype(np.int16) - gray.astype(np.int16)


def _drop_faint(contrast: np.ndarray, segs: list[list[float]], blocks: list) -> tuple[list, list, float]:
    """Keep the lines and blocks whose ink is about as dark as the usual wall
    line. Also gives that usual darkness."""
    if not segs:
        return segs, [], 0.0
    h, w = contrast.shape
    darkness = []
    for s in segs:
        n = int(_length(s)) + 1
        xs, ys = np.linspace(s[0], s[2], n), np.linspace(s[1], s[3], n)
        nx, ny = -(s[3] - s[1]) / max(1.0, _length(s)), (s[2] - s[0]) / max(1.0, _length(s))
        best = np.full(n, -255, np.int16)
        for o in range(-SIDE_PX, SIDE_PX + 1):
            cx = np.clip(np.round(xs + nx * o).astype(int), 0, w - 1)
            cy = np.clip(np.round(ys + ny * o).astype(int), 0, h - 1)
            best = np.maximum(best, contrast[cy, cx])
        darkness.append(float(np.median(best)))
    # The usual wall: the darkness that half of the total line length reaches.
    order = np.argsort(darkness)[::-1]
    lengths = np.array([_length(segs[i]) for i in order])
    usual = darkness[order[np.searchsorted(np.cumsum(lengths), lengths.sum() / 2)]]
    kept = []
    for b in blocks:
        m = np.zeros((h, w), np.uint8)
        cv2.fillPoly(m, [np.array(b, np.int32)], 1)
        # The darkest quarter of a block's pixels is its ink: hatching or fill.
        if np.percentile(contrast[m > 0], 75) >= FAINT_BLOCK * usual:
            kept.append(b)
    return [s for s, d in zip(segs, darkness) if d >= FAINT_LINE * usual], kept, usual


def _drop_coloured(img: np.ndarray, contrast: np.ndarray, segs: list[list[float]]) -> list[list[float]]:
    """Keep the lines whose ink has about the colour of the usual wall line.
    The colour is the Lab chroma of the darkest pixel across the line. Chroma,
    not HSV saturation: the saturation of near-black pixels is noise.
    A black wall beside a painted area takes on some of its colour in a
    photo. So a coloured line goes only when it is at least about as
    coloured as the paper or paint on both sides of it."""
    if not segs:
        return segs
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    chroma = np.hypot(lab[:, :, 1] - 128, lab[:, :, 2] - 128)
    h, w = contrast.shape
    colour, peak = [], []
    for s in segs:
        n = int(_length(s)) + 1
        xs, ys = np.linspace(s[0], s[2], n), np.linspace(s[1], s[3], n)
        nx, ny = -(s[3] - s[1]) / max(1.0, _length(s)), (s[2] - s[0]) / max(1.0, _length(s))
        best = np.full(n, -255, np.int16)
        at = np.zeros(n, np.float32)
        for o in range(-SIDE_PX, SIDE_PX + 1):
            cx = np.clip(np.round(xs + nx * o).astype(int), 0, w - 1)
            cy = np.clip(np.round(ys + ny * o).astype(int), 0, h - 1)
            c = contrast[cy, cx]
            darker = c > best
            best = np.where(darker, c, best)
            at = np.where(darker, chroma[cy, cx], at)
        sides = []
        for o in (-PEAK_SIDE, PEAK_SIDE):
            cx = np.clip(np.round(xs + nx * o).astype(int), 0, w - 1)
            cy = np.clip(np.round(ys + ny * o).astype(int), 0, h - 1)
            sides.append(chroma[cy, cx])
        colour.append(float(np.median(at)))
        peak.append(float(np.median(at - np.maximum(*sides))))
    # The usual wall: the colour that half of the total line length stays under.
    order = np.argsort(colour)
    lengths = np.array([_length(segs[i]) for i in order])
    usual = colour[order[np.searchsorted(np.cumsum(lengths), lengths.sum() / 2)]]
    return [s for s, c, p in zip(segs, colour, peak) if c <= usual + COLOURED or p < -PEAK_MARGIN]

