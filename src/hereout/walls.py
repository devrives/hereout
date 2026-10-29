"""Turn a flat plan image into a wall mask.

Walls are ink: darker than the paper around them. Most plans draw walls in
black or grey, and then coloured ink is a sign or an arrow. Some plans draw
walls in one colour (often red). When most of the ink in the floor drawing
has one hue, that hue is the wall colour and we keep the ink of that hue
instead. Small blobs are mostly text and are dropped.
Thick ink much fainter than the darkest ink of the plan is a fill, not a
wall: many plans paint the escape routes as soft bands, and the edge of a
band looks like a line to the local threshold. Thin faint lines stay, because
a thin wall looks faint in a blurred photo.
Door gaps are kept open: we never close gaps. Door swings, hatching and
text are drawn thinner than walls, so strokes much thinner than the usual
wall stroke are removed.

Outside the box of the floor drawing everything counts as wall, so a route
never runs through the legend or around the page.
"""

from __future__ import annotations

import cv2
import numpy as np

MAX_SATURATION = 110   # 0-255; above this a dark pixel is a coloured sign
COLOURED_INK_SHARE = 0.5  # coloured walls when this share of the ink is saturated
HUE_TOLERANCE = 14     # OpenCV hue units (0-180)
MIN_INK_SATURATION = 45
BOX_MARGIN = 0.02      # share of the image added around the plan box
THIN_SHARE = 0.55      # strokes thinner than this share of the wall stroke go
MIN_BLOB_SHARE = 0.05   # a blob whose box is smaller than this share of the image is text,
MIN_BAR_SHARE = 0.015   # unless it is a thin bar (a short wall piece) at least this long
BAR_ASPECT = 4.0
FAINT_SHARE = 0.5      # ink fainter than this share of the strong ink (90th percentile) may be a fill
FILL_SHARE = 0.005     # faint ink at least this share of the image thick is a fill


def _ink(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    block = max(15, (max(h, w) // 24) | 1)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                 cv2.THRESH_BINARY_INV, block, 18)


def _drop_faint(img: np.ndarray, ink: np.ndarray, plan_box=None) -> None:
    """Clear thick ink whose darkness against the local paper is weak, in place."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    k = max(15, (max(h, w) // 40) | 1)
    # A closing removes the lines and leaves the paper around them.
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    contrast = paper.astype(int) - gray.astype(int)
    ys, xs = _box_slice(img.shape, plan_box)
    sel = ink[ys, xs] > 0
    if sel.sum() <= 100:
        return
    faint = ((ink > 0) & (contrast < FAINT_SHARE * np.percentile(contrast[ys, xs][sel], 90))).astype(np.uint8)
    t = max(3, round(FILL_SHARE * max(h, w)))
    fill = cv2.morphologyEx(faint, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (t, t)))
    ink[fill > 0] = 0


def _box_slice(shape, plan_box):
    h, w = shape[:2]
    if plan_box is None:
        return slice(0, h), slice(0, w)
    x0, y0, x1, y1 = (int(v) for v in plan_box)
    return slice(max(0, y0), min(h, y1)), slice(max(0, x0), min(w, x1))


def wall_hue(img: np.ndarray, plan_box=None, ink: np.ndarray | None = None) -> int | None:
    """The hue of the walls when the drawing uses coloured walls, else None."""
    ink = _ink(img) if ink is None else ink
    ys, xs = _box_slice(img.shape, plan_box)
    hsv = cv2.cvtColor(img[ys, xs], cv2.COLOR_BGR2HSV)
    sel = ink[ys, xs] > 0
    if sel.sum() < 100:
        return None
    sat = hsv[:, :, 1][sel]
    coloured = sat > MAX_SATURATION
    if coloured.mean() < COLOURED_INK_SHARE:
        return None
    hist = np.bincount(hsv[:, :, 0][sel][coloured], minlength=180).astype(float)
    # Hue is circular; smooth with wrap-around before taking the peak.
    k = np.ones(2 * HUE_TOLERANCE + 1)
    smooth = np.convolve(np.concatenate([hist[-HUE_TOLERANCE:], hist, hist[:HUE_TOLERANCE]]), k, "valid")
    return int(np.argmax(smooth))


def stroke_width(mask: np.ndarray, plan_box=None) -> float:
    """The usual stroke width of the ink, in pixels (median over the ridges)."""
    ys, xs = _box_slice(mask.shape, plan_box)
    m = mask[ys, xs].astype(np.uint8)
    if m.sum() < 50:
        return 0.0
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
    ridge = (dist >= cv2.dilate(dist, np.ones((3, 3), np.uint8))) & (m > 0)
    values = dist[ridge]
    # Each ridge pixel is weighted by its width, so long thick walls win over
    # many small letters.
    order = np.sort(values)
    cum = np.cumsum(order)
    return float(2 * order[np.searchsorted(cum, cum[-1] / 2)])


def _drop_thin(walls: np.ndarray, plan_box=None) -> np.ndarray:
    width = stroke_width(walls, plan_box)
    k = int(round(THIN_SHARE * width))
    if k < 3:
        return walls  # thin-line plans: every stroke may be a wall
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.morphologyEx(walls.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool)


def strong_ink(img: np.ndarray, plan_box=None) -> tuple[np.ndarray, int | None]:
    """The ink without faint fills, and the wall hue (wall_hue). Both wall
    passes start from it, so find_walls makes it once."""
    dark = _ink(img)
    _drop_faint(img, dark, plan_box)
    return dark, wall_hue(img, plan_box, dark)


def wall_mask(img: np.ndarray, plan_box: tuple[float, float, float, float] | None = None,
              ink: tuple[np.ndarray, int | None] | None = None) -> np.ndarray:
    """Return a bool array, True where a wall is.

    plan_box is (x0, y0, x1, y1) in pixels. ink: strong_ink(img, plan_box), when the caller has it.
    """
    h, w = img.shape[:2]
    dark, target = strong_ink(img, plan_box) if ink is None else (ink[0].copy(), ink[1])
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hue, sat = hsv[:, :, 0].astype(int), hsv[:, :, 1]
    if target is not None:
        diff = np.abs(hue - target)
        diff = np.minimum(diff, 180 - diff)
        dark[(diff > HUE_TOLERANCE) | (sat < MIN_INK_SATURATION)] = 0
    else:
        dark[sat > MAX_SATURATION] = 0

    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    bw = stats[1:, cv2.CC_STAT_WIDTH].astype(float)
    bh = stats[1:, cv2.CC_STAT_HEIGHT].astype(float)
    long_side, short_side = np.maximum(bw, bh), np.minimum(bw, bh)
    big = long_side >= MIN_BLOB_SHARE * max(h, w)
    bar = (long_side >= MIN_BAR_SHARE * max(h, w)) & (long_side >= BAR_ASPECT * short_side)
    keep = np.zeros(n, dtype=bool)
    keep[1:] = big | bar
    walls = keep[labels]
    walls = _drop_thin(walls, plan_box)

    return walls | outside_box(walls.shape, plan_box)


def outside_box(shape, plan_box=None) -> np.ndarray:
    """True outside the plan box with its margin. All False without a box."""
    h, w = shape[:2]
    out = np.zeros((h, w), dtype=bool)
    if plan_box is not None:
        m = BOX_MARGIN * max(h, w)
        x0, y0 = max(0, int(plan_box[0] - m)), max(0, int(plan_box[1] - m))
        x1, y1 = min(w, int(plan_box[2] + m)), min(h, int(plan_box[3] + m))
        if x1 > x0 and y1 > y0:
            out[:] = True
            out[y0:y1, x0:x1] = False
    return out
