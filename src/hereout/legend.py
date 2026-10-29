"""Find the legend boxes of a plan and drop the exits that the model put in them.

A legend box is a framed rectangle outside the floor drawing with a column of
text lines (OCR text boxes with the same left edge). The model can point to the
exit sign of the legend; that is never a final exit. On the 203 gallery plans,
every exit this check dropped was in a legend or a text panel
(wiki/decisions/wall-method-tests.md).
"""

from __future__ import annotations

import cv2
import numpy as np

from .walls import _ink

MIN_AREA, MAX_AREA = 0.02, 0.4   # share of the image
FRAME_FILL = 0.85      # the convex hull fills this share of the bounding box: a frame, not a blob
SQUARE_FILL = 0.95     # a frame this full can have more corners: a heading tab or a joined line bends its outline
MAX_CORNERS = 12
MIN_TEXTS = 4
MIN_COLUMN = 3         # text lines that share a left edge
COLUMN_TOL = 0.01      # share of the image width
MAX_INSIDE = 0.4       # a box more inside the floor drawing than this is a room, not a legend


def legend_boxes(img: np.ndarray, text: list, plan_box=None) -> list[tuple[int, int, int, int]]:
    h, w = img.shape[:2]
    area = h * w
    ink = (_ink(img) > 0).astype(np.uint8)
    cnts, _ = cv2.findContours(ink, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [np.array(b) for b in text]
    out = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        if not (MIN_AREA * area <= bw * bh <= MAX_AREA * area):
            continue
        fill = cv2.contourArea(cv2.convexHull(c))
        if fill < FRAME_FILL * bw * bh:
            continue
        corners = len(cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True))
        if corners != 4 and not (fill >= SQUARE_FILL * bw * bh and corners <= MAX_CORNERS):
            continue
        inside = [b for b in boxes if x < b[:, 0].mean() < x + bw and y < b[:, 1].mean() < y + bh]
        if len(inside) < MIN_TEXTS:
            continue
        lefts = [b[:, 0].min() for b in inside]
        if max(sum(abs(a - b) < COLUMN_TOL * w for b in lefts) for a in lefts) < MIN_COLUMN:
            continue
        if plan_box is not None:
            ix = max(0, min(x + bw, plan_box[2]) - max(x, plan_box[0]))
            iy = max(0, min(y + bh, plan_box[3]) - max(y, plan_box[1]))
            if ix * iy > MAX_INSIDE * bw * bh:
                continue
        out.append((x, y, x + bw, y + bh))
    return out


def drop_legend_exits(img: np.ndarray, text: list, exits: list[dict], plan_box=None) -> list[dict]:
    """The exits that are not in a legend box. At least one exit stays."""
    boxes = legend_boxes(img, text, plan_box)
    kept = [e for e in exits if not any(x0 < e["x"] < x1 and y0 < e["y"] < y1 for x0, y0, x1, y1 in boxes)]
    return kept or exits
