"""Find the legend boxes and the text blocks of a plan, and drop the exits
that the model put in them.

A legend box is a framed rectangle outside the floor drawing with a column of
text lines (OCR text boxes with the same left edge). The model can point to the
exit sign of the legend; that is never a final exit. On the 203 gallery plans,
every exit this check dropped was in a legend or a text panel
(wiki/decisions/wall-method-tests.md).

A text block is a paragraph of running text with no frame, for example the
instructions under the plan: three or more long text lines stacked close,
which cover most of their bounding box, with almost no other ink in it. The
model can put an exit on such a line when an arrow of the drawing ends near
it. The model's floor box can include the block, so the block is found from
the text, not from the box. A short label of an exit (two or three short
lines) is not running text, so its exit stays.
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

LONG_LINE = 8.0        # a text box this many times as wide as high is a line of running text
LINE_GAP = 0.8         # line heights: stacked lines of one block are this close
WORD_GAP = 1.5         # line heights: boxes of one row are this close
SIZE_RATIO = 2.5       # lines of one block differ in height by less than this factor
BLOCK_ROWS = 3
BLOCK_FILL = 0.6       # the text boxes cover this share of the block's bounding box
BLOCK_INK = 0.02       # share of the block's area: more ink outside the text is a drawing
ON_LINE = 0.5          # line heights: an exit this close to a line of the block is on it
TEXT_PAD = 3           # px of ink around a text box that belongs to the text


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


def _rects(text: list) -> list[tuple[float, float, float, float]]:
    out = []
    for b in text:
        p = np.asarray(b, float)
        (x0, y0), (x1, y1) = p.min(0), p.max(0)
        if x1 > x0 and y1 > y0:
            out.append((x0, y0, x1, y1))
    return out


def _groups(rs: list) -> list[list[int]]:
    """Text boxes joined into blocks: lines stacked close with overlap, or boxes of one row."""
    parent = list(range(len(rs)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, a in enumerate(rs):
        for j in range(i + 1, len(rs)):
            b = rs[j]
            ha, hb = a[3] - a[1], b[3] - b[1]
            h = min(ha, hb)
            if max(ha, hb) > SIZE_RATIO * h:
                continue
            ox, oy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            gx, gy = max(a[0], b[0]) - min(a[2], b[2]), max(a[1], b[1]) - min(a[3], b[3])
            if (ox > 0 and gy <= LINE_GAP * h) or (oy > 0.5 * h and gx <= WORD_GAP * h):
                parent[root(i)] = root(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(rs)):
        groups.setdefault(root(i), []).append(i)
    return list(groups.values())


def text_block_exits(img: np.ndarray, text: list, exits: list[dict]) -> set[int]:
    """The indices of the exits on a line of a text block (see the module text)."""
    rs = _rects(text)
    longs = [i for i, (x0, y0, x1, y1) in enumerate(rs) if x1 - x0 >= LONG_LINE * (y1 - y0)]
    if len(longs) < BLOCK_ROWS or not exits:
        return set()
    h, w = img.shape[:2]
    covered = np.zeros((h, w), np.uint8)
    for x0, y0, x1, y1 in rs:
        covered[int(y0):int(np.ceil(y1)), int(x0):int(np.ceil(x1))] = 1
    near_text = cv2.dilate(covered, np.ones((2 * TEXT_PAD + 1,) * 2, np.uint8)) > 0
    ink = None
    gap = lambda r, x, y: float(np.hypot(max(r[0] - x, 0, x - r[2]), max(r[1] - y, 0, y - r[3])))
    found = set()
    for g in _groups([rs[i] for i in longs]):
        lines = [rs[longs[i]] for i in g]
        lh = float(np.median([b[3] - b[1] for b in lines]))
        mids = sorted((b[1] + b[3]) / 2 for b in lines)
        if 1 + sum(q - p > 0.5 * lh for p, q in zip(mids, mids[1:])) < BLOCK_ROWS:
            continue
        x0, y0 = int(min(b[0] for b in lines)), int(min(b[1] for b in lines))
        x1, y1 = int(np.ceil(max(b[2] for b in lines))), int(np.ceil(max(b[3] for b in lines)))
        if covered[y0:y1, x0:x1].mean() < BLOCK_FILL:
            continue
        if ink is None:
            ink = _ink(img) > 0
        if (ink[y0:y1, x0:x1] & ~near_text[y0:y1, x0:x1]).mean() > BLOCK_INK:
            continue
        for k, e in enumerate(exits):
            x, y = e["x"], e["y"]
            if not (y0 < y < y1 and x0 - lh < x < x1 + lh):
                continue
            # The text box nearest to the exit must be a line of this block, not a label beside it.
            nearest = min(rs, key=lambda r: gap(r, x, y))
            if nearest in lines and gap(nearest, x, y) <= ON_LINE * lh:
                found.add(k)
    return found


def drop_text_exits(img: np.ndarray, text: list, exits: list[dict]) -> list[dict]:
    """The exits that are not on a line of a text block. At least one exit stays."""
    drop = text_block_exits(img, text, exits)
    kept = [e for k, e in enumerate(exits) if k not in drop]
    return kept or exits


def drop_legend_exits(img: np.ndarray, text: list, exits: list[dict], plan_box=None) -> list[dict]:
    """The exits that are not in a legend box. At least one exit stays."""
    boxes = legend_boxes(img, text, plan_box)
    kept = [e for e in exits if not any(x0 < e["x"] < x1 and y0 < e["y"] < y1 for x0, y0, x1, y1 in boxes)]
    return kept or exits
