"""Find the rectangles crossed by an X: a lift shaft or an open void.

Many plans draw a lift shaft or a void as a rectangle of walls with its two
diagonals. Inside it is no floor: a tap there must get no route, and no door
may be cut into it (ink_walls.room_doors). The X cuts the paper inside the
rectangle into four triangles that meet in its middle. So the search starts
from the paper, not from lines:
- a paper area that fills about half of its bounding box and has the outline
  of a triangle,
- with one level or upright side: mirrored across the opposite corner (the
  middle of the void), it gives the rectangle,
- four different paper areas in the rectangle, one beside each side, whose
  bounds together are the rectangle,
- ink along the four sides and along both diagonals.
On the 203 gallery plans this found 4 voids, all of them lift shafts with an X
(RU-commons_000258, RU-commons_000259, RU-commons_000338, TW-commons_000049).
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from .walls import _ink

MIN_SIDE = 0.02            # share of the image side: the shortest side of a void
MAX_VOID = 0.25            # share of the image: the largest void
HALF_FILL = (0.35, 0.65)   # a triangle fills about half of its bounding box
LEVEL = 0.08               # a side is level or upright within this share of its length
MIDDLE_TOL = 0.08          # share of the short side: the corner of each triangle is this close to the middle
LINE_INK = 0.85            # share of each side and of each diagonal on ink
BAND = 0.004               # share of the image side: the band round a line that counts as on it


def _on_ink(grown: np.ndarray, xa, ya, xb, yb) -> float:
    n = int(max(abs(xb - xa), abs(yb - ya))) + 1
    t = np.linspace(0, 1, n)
    xs = np.clip(np.round(xa + t * (xb - xa)).astype(int), 0, grown.shape[1] - 1)
    ys = np.clip(np.round(ya + t * (yb - ya)).astype(int), 0, grown.shape[0] - 1)
    return float(grown[ys, xs].mean())


def _void_of(tri: np.ndarray, lab: np.ndarray, st: np.ndarray, grown: np.ndarray, min_side: float,
             max_area: float) -> tuple[int, int, int, int] | None:
    """The void that this triangle of paper is one quarter of, or None."""
    for k in range(3):
        p, q, apex = tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]
        dx, dy = abs(float(q[0] - p[0])), abs(float(q[1] - p[1]))
        n = math.hypot(dx, dy)
        if n < min_side:
            continue
        if dy <= LEVEL * n:     # a level side
            x0, x1 = min(p[0], q[0]), max(p[0], q[0])
            y = (p[1] + q[1]) / 2
            y0, y1 = sorted((y, 2 * apex[1] - y))
        elif dx <= LEVEL * n:   # an upright side
            y0, y1 = min(p[1], q[1]), max(p[1], q[1])
            x = (p[0] + q[0]) / 2
            x0, x1 = sorted((x, 2 * apex[0] - x))
        else:
            continue
        short = min(x1 - x0, y1 - y0)
        if short < min_side or (x1 - x0) * (y1 - y0) > max_area:
            continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if math.hypot(apex[0] - cx, apex[1] - cy) > MIDDLE_TOL * short:
            continue
        parts = {int(lab[int(py), int(px)]) for px, py in
                 (((cx + x0) / 2, cy), ((cx + x1) / 2, cy), (cx, (cy + y0) / 2), (cx, (cy + y1) / 2))}
        if 0 in parts or len(parts) != 4:
            continue
        ux0, uy0 = min(st[c, 0] for c in parts), min(st[c, 1] for c in parts)
        ux1, uy1 = max(st[c, 0] + st[c, 2] for c in parts), max(st[c, 1] + st[c, 3] for c in parts)
        if max(abs(ux0 - x0), abs(uy0 - y0), abs(ux1 - x1), abs(uy1 - y1)) > MIDDLE_TOL * short:
            continue
        lines = ((ux0, uy0, ux1, uy0), (ux0, uy1, ux1, uy1), (ux0, uy0, ux0, uy1), (ux1, uy0, ux1, uy1),
                 (ux0, uy0, ux1, uy1), (ux1, uy0, ux0, uy1))
        if all(_on_ink(grown, *ln) >= LINE_INK for ln in lines):
            return int(ux0), int(uy0), int(ux1), int(uy1)
    return None


def x_voids(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """The rectangles crossed by an X, as (x0, y0, x1, y1) of their inside."""
    ink = _ink(img) > 0
    h, w = ink.shape
    side = max(h, w)
    band = max(2, int(BAND * side))
    grown = cv2.dilate(ink.astype(np.uint8), np.ones((2 * band + 1,) * 2, np.uint8)) > 0
    n, lab, st, _ = cv2.connectedComponentsWithStats((~ink).astype(np.uint8), connectivity=4)
    min_side, max_area = MIN_SIDE * side, MAX_VOID * h * w
    out: list[tuple[int, int, int, int]] = []
    for c in range(1, n):
        x, y, bw, bh, area = st[c]
        if min(bw, bh) < min_side / 2 or area > max_area / 4 or not HALF_FILL[0] <= area / (bw * bh) <= HALF_FILL[1]:
            continue
        cnts, _ = cv2.findContours((lab[y:y + bh, x:x + bw] == c).astype(np.uint8), cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cnts, key=cv2.contourArea)
        tri = cv2.approxPolyDP(cnt, 0.04 * cv2.arcLength(cnt, True), True).reshape(-1, 2) + [x, y]
        if len(tri) != 3:
            continue
        r = _void_of(tri, lab, st, grown, min_side, max_area)
        if r and not any(sum(abs(a - b) for a, b in zip(r, q)) < 0.02 * side for q in out):
            out.append(r)
    return out


def void_mask(img: np.ndarray, plan_box=None, exits=()) -> np.ndarray:
    """True inside each X-crossed rectangle in the floor box, with its walls.
    A rectangle with an exit point in it stays open: the model saw a door there."""
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for x0, y0, x1, y1 in x_voids(img):
        if plan_box is not None and not (plan_box[0] <= (x0 + x1) / 2 <= plan_box[2]
                                         and plan_box[1] <= (y0 + y1) / 2 <= plan_box[3]):
            continue
        if any(x0 <= ex <= x1 and y0 <= ey <= y1 for ex, ey in exits):
            continue
        mask[y0:y1 + 1, x0:x1 + 1] = 1
    return mask > 0
