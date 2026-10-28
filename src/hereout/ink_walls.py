"""Walls from all the ink of the drawing, not only from the wall lines.

wall_lines.py finds straight wall lines, and it misses many walls: thin ones,
bent ones, walls that touch text. The ways out then cross walls on the photo.
Here every dark line of the drawing counts, after these are taken out:
- text: the boxes of an OCR text detector (RapidOCR, detection only), in any script
- colour: signs, arrows, printed routes (Lab chroma against the paper)
- specks: small blobs that are not a short bar

What is left is split in two:
- hard walls: thick strokes, long straight thin lines, and the wall lines.
  A route never crosses them.
- soft lines: the other thin ink, mostly door swings and dashes. A route can
  cross them at a cost (route.py SOFT_COST); a straight line of the map never does.

Outside the building is blocked too: the open paper around the drawing, found
from the edge of the image. A closing of the walls (wider than a door) and a
probe (wider than a door) must both say outside, so a wide entrance and a
corridor with an open end both stay inside.
"""

from __future__ import annotations

import threading

import cv2
import numpy as np

from .walls import _drop_faint, _ink, outside_box, stroke_width, wall_hue

CHROMA = 14.0          # Lab chroma above the paper: coloured ink, not a wall
TEXT_PAD = 3           # px around each text box
MIN_LEN = 0.012        # share of the image: a shorter blob is a speck,
BAR_LEN = 0.006        # unless it is a bar at least this long
BAR_ASPECT = 3.0
THICK_SHARE = 0.55     # an opening of this share of the usual stroke keeps the thick strokes
STRAIGHT = 0.025       # share of the image: a thin straight line this long is a wall
CLOSE_SHARE = 0.08     # share of the image: the closings that find the footprint of the building
PROBE_SHARE = 0.012    # radius of the probe that does not go into corridors
MIN_INSIDE = 0.15      # keep the outside open when less of the open floor stays inside

_ocr = None
_ocr_lock = threading.Lock()


def text_boxes(img: np.ndarray) -> list[list[list[int]]]:
    """The boxes of the text in the image, as four corner points each."""
    global _ocr
    with _ocr_lock:
        if _ocr is None:
            from rapidocr import RapidOCR
            _ocr = RapidOCR(params={"Global.use_cls": False, "Global.use_rec": False,
                                    "Global.log_level": "error"})
        r = _ocr(img, use_det=True, use_cls=False, use_rec=False)
    if r.boxes is None:
        return []
    return np.asarray(r.boxes).round().astype(int).tolist()


def _chroma(img: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    return np.hypot(a - np.median(a), b - np.median(b))


def drawn_ink(img: np.ndarray, plan_box=None, boxes=None) -> np.ndarray:
    """The dark lines of the drawing, without text, colour, fills and specks."""
    h, w = img.shape[:2]
    side = max(h, w)
    raw = _ink(img)
    _drop_faint(img, raw, plan_box)
    ink = raw > 0
    if wall_hue(img, plan_box, raw) is None:
        ink[_chroma(img) > CHROMA] = False
    for bx in text_boxes(img) if boxes is None else boxes:
        p = np.int32(bx)
        x0, y0 = p.min(0) - TEXT_PAD
        x1, y1 = p.max(0) + TEXT_PAD
        ink[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = False
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    bw, bh = st[1:, cv2.CC_STAT_WIDTH].astype(float), st[1:, cv2.CC_STAT_HEIGHT].astype(float)
    long_side, short_side = np.maximum(bw, bh), np.minimum(bw, bh)
    keep = np.zeros(n, bool)
    keep[1:] = (long_side >= MIN_LEN * side) | ((long_side >= BAR_LEN * side) & (long_side >= BAR_ASPECT * short_side))
    return keep[lab]


def hard_ink(ink: np.ndarray, plan_box=None) -> np.ndarray:
    """Thick strokes, and the thin strokes on long straight lines."""
    side = max(ink.shape)
    k = int(round(THICK_SHARE * stroke_width(ink, plan_box)))
    thick = np.zeros_like(ink)
    if k >= 3:
        opened = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_OPEN,
                                  cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        thick = (cv2.dilate(opened, np.ones((3, 3), np.uint8)) > 0) & ink
    thin = (ink & ~thick).astype(np.uint8) * 255
    length = int(STRAIGHT * side)
    segs = cv2.HoughLinesP(thin, 1, np.pi / 360, threshold=int(length * 0.6), minLineLength=length, maxLineGap=2)
    out = thick.astype(np.uint8)
    if segs is not None:
        for x0, y0, x1, y1 in segs.reshape(-1, 4):
            cv2.line(out, (int(x0), int(y0)), (int(x1), int(y1)), 1, 2)
    return out > 0


def outside_building(walls: np.ndarray, plan_box=None) -> np.ndarray:
    """The open paper around the building. walls has no margin of outside_box."""
    h, w = walls.shape
    side = max(h, w)
    # A closing with a line along each wall direction closes a door gap in a
    # thin wall; a round kernel closes only gaps much smaller than itself.
    k = max(3, int(CLOSE_SHARE * side))
    m = walls.astype(np.uint8)
    closed = np.zeros_like(m)
    for kernel in (np.ones((1, k), np.uint8), np.ones((k, 1), np.uint8)):
        closed |= cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
    out = _from_edge((1 - closed).astype(np.uint8)) & ~walls
    r = max(2, int(PROBE_SHARE * side))
    probe = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    core = cv2.erode((~walls).astype(np.uint8), probe)
    out &= cv2.dilate(_from_edge(core).astype(np.uint8), probe) > 0
    floor = ~walls & ~outside_box(walls.shape, plan_box)
    if (floor & ~out).sum() < MIN_INSIDE * floor.sum():
        return np.zeros_like(out)  # no outer wall in the drawing
    return out


def _from_edge(free: np.ndarray) -> np.ndarray:
    """The free pixels connected to the edge of the image."""
    pad = cv2.copyMakeBorder(free, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
    _, lab = cv2.connectedComponents(pad, connectivity=4)
    return lab[1:-1, 1:-1] == lab[0, 0]


def ink_walls(img: np.ndarray, line_walls: np.ndarray, plan_box=None, boxes=None) -> tuple[np.ndarray, np.ndarray]:
    """The hard walls (with the wall lines and the outside) and the soft lines."""
    ink = drawn_ink(img, plan_box, boxes)
    grow = lambda m: cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    box_out = outside_box(line_walls.shape, plan_box)
    hard = grow(hard_ink(ink, plan_box)) | line_walls
    soft = grow(ink) & ~hard
    hard |= outside_building((line_walls | grow(ink)) & ~box_out, plan_box) | box_out
    return hard, soft & ~hard
