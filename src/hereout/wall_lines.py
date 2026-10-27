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
4. Pieces on one line with a gap smaller than a door are one line.
5. A line or block much fainter than the usual wall line is the edge of a
   painted band or a light detail, not a wall.

A wall that is not straight (a wavy wall, a row of columns) gives no line.

The walls to route in are these lines, drawn a little longer at each end so
a corner has no leak, the blocks, and everything outside the plan box.
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
ANGLE_TOL = math.radians(4)
FAINT_LINE = 0.6       # a line with less contrast than this share of the usual wall is not a wall
FAINT_BLOCK = 0.67     # the same for a block, with the darkest quarter of its pixels
SIDE_PX = 3            # look this far to each side of a line for its darkest ink
END_SHARE = 0.003      # each line is drawn this much longer at each end
PAPER_SHARE = 1 / 40   # the closing that finds the paper colour, as in walls.py


def plan_walls(img: np.ndarray, plan_box=None) -> tuple[np.ndarray, dict]:
    """The wall mask to route in, and the walls to draw: lines [x0, y0, x1, y1, width]
    and blocks (filled areas, as polygons)."""
    lines, blocks = find_lines(img, wall_mask(img, plan_box), plan_box)
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

    segs = _join([s for s in segs if _length(s) >= min_len / 2], JOIN_SHARE * side)
    segs = [s for s in segs if _length(s) >= min_len]
    contrast = _contrast(img)
    segs, blocks = _drop_faint(contrast, segs, blocks)

    lines = [[round(v) for v in s[:4]] + [max(1, round(s[4]))] for s in segs]
    return lines, [[[round(x), round(y)] for x, y in b] for b in blocks]


def draw_walls(lines: list[list[int]], blocks: list[list[list[int]]], shape, plan_box=None) -> np.ndarray:
    h, w = shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for b in blocks:
        cv2.fillPoly(mask, [np.array(b, np.int32)], 1)
    grow = END_SHARE * max(h, w)
    for x0, y0, x1, y1, width in lines:
        n = math.hypot(x1 - x0, y1 - y0) or 1.0
        dx, dy = (x1 - x0) / n * grow, (y1 - y0) / n * grow
        cv2.line(mask, _pt(x0 - dx, y0 - dy), _pt(x1 + dx, y1 + dy), 1, max(2, width))
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


def _relation(p, walls):
    """For piece p and each wall: is it parallel, its offset from the wall
    line, and the span of p along the wall."""
    start, u, ln = _frame(walls)
    lp = max(_length(p), 1e-9)
    pd = np.array([p[2] - p[0], p[3] - p[1]]) / lp
    parallel = np.abs(u[:, 0] * pd[1] - u[:, 1] * pd[0]) <= math.sin(ANGLE_TOL)
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


def _join(segs: list[list[float]], gap: float) -> list[list[float]]:
    """Join pieces on one line whose gap is at most gap, until none is left."""
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
                hit = np.flatnonzero(ok)
                if hit.size:
                    i = int(hit[0])
                    a = out[i]
                    start, u, _ = _frame([a])
                    t0, t1 = min(0.0, lo[i]), max(ln[i], hi[i])
                    out[i] = [*(start[0] + u[0] * t0), *(start[0] + u[0] * t1), max(a[4], b[4])]
                    joined = True
                    continue
            out.append(b)
        segs = out
    return segs


def _contrast(img: np.ndarray) -> np.ndarray:
    """How much darker each pixel is than the paper around it."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    k = max(15, int(max(h, w) * PAPER_SHARE) | 1)
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    return paper.astype(np.int16) - gray.astype(np.int16)


def _drop_faint(contrast: np.ndarray, segs: list[list[float]], blocks: list) -> tuple[list, list]:
    """Keep the lines and blocks whose ink is about as dark as the usual wall line."""
    if not segs:
        return segs, []
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
    return [s for s, d in zip(segs, darkness) if d >= FAINT_LINE * usual], kept
