"""Walls from all the ink of the drawing, not only from the wall lines.

wall_lines.py finds straight wall lines, and it misses many walls: thin ones,
bent ones, walls that touch text. The ways out then cross walls on the photo.
Here every dark line of the drawing counts, after these are taken out:
- text: the boxes of an OCR text detector (RapidOCR, detection only), in any script
- colour: signs, arrows, printed routes (Lab chroma against the paper)
- specks: small blobs that are not a short bar

What is left is split in two (wiki/decisions/wall-method-tests.md):
- hard walls: the thick strokes, kept whole by an opening by reconstruction
  (Dosch and others 2000), and the thin lines that touch thick walls at two
  places (wall pieces between them). A route never crosses them.
- soft lines: the other thin ink, mostly door leaves, door arcs, rails and
  dashes. A route can cross them at a cost (route.py SOFT_COST); a straight
  line of the map never does.

Door arcs become openings: a skeleton branch of the thin ink that fits a
quarter circle is a door swing, and the two chords from its hinge are cut out
of the walls. A plan with only thin strokes keeps the long straight lines as
walls instead.

Each drawing on the sheet gets a footprint: the walls closed along each axis
(wider than a door), then filled. Everything outside every footprint is
closed, so a way never crosses the paper between two drawings or around one.
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
STRAIGHT = 0.025       # share of the image: on thin-stroke plans, a straight line this long is a wall
ANCHORS = 2            # a thin line that touches thick walls at this many places is a wall
CLOSE_SHARE = 0.04     # share of the image: the closings that find each footprint
MIN_DRAWING = 0.01     # share of the floor box: a smaller footprint is not a drawing
MIN_FILL = 0.3         # a footprint that fills less of its bounding box is an open outline
BRIDGE_MAX = 0.15      # share of the image: the widest gap in a wall that a bridge closes
BRIDGE_LOOK = 0.01     # share of the image: the part of a wall that gives its direction at an end
BRIDGE_ANGLE = 15      # degrees: the two ends must face each other this well
ARC_RADIUS = (0.01, 0.07)   # share of the image: the radius of a door arc
ARC_SWEEP = (55, 125)       # degrees
ARC_FIT = 0.12              # mean distance from the circle, as a share of the radius
DOOR_CUT = 0.006            # share of the image: the width of the cut through a door

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


def straight_lines(ink: np.ndarray) -> np.ndarray:
    """The long straight lines of the ink."""
    length = int(STRAIGHT * max(ink.shape))
    segs = cv2.HoughLinesP(ink.astype(np.uint8) * 255, 1, np.pi / 360, threshold=int(length * 0.6),
                           minLineLength=length, maxLineGap=2)
    out = np.zeros(ink.shape, np.uint8)
    if segs is not None:
        for x0, y0, x1, y1 in segs.reshape(-1, 4):
            cv2.line(out, (int(x0), int(y0)), (int(x1), int(y1)), 1, 2)
    return out > 0


def split_strokes(ink: np.ndarray, plan_box=None) -> tuple[np.ndarray, np.ndarray]:
    """The hard walls and the thin ink. On a plan with only thin strokes,
    the hard walls are the long straight lines."""
    width = stroke_width(ink, plan_box)
    n = int(width // 2)
    if n < 2:
        return straight_lines(ink) & ink, ink
    mask = ink.astype(np.uint8)
    marker = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * n + 1, 2 * n + 1)))
    # Opening by reconstruction: grow the eroded core back inside the ink, so
    # wall ends and short stubs between doors stay whole.
    k = np.ones((3, 3), np.uint8)
    for _ in range(n + 1 + int(width)):
        grown = cv2.dilate(marker, k) & mask
        if np.array_equal(grown, marker):
            break
        marker = grown
    thick = marker > 0
    thin = ink & ~thick
    hard = thick.copy()
    # A thin line between two thick walls is a wall piece; one that touches a
    # wall at one place only (a door leaf, an arc, a stub) is not.
    _, lab = cv2.connectedComponents(thin.astype(np.uint8), connectivity=8)
    contact = (cv2.dilate(thick.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & thin
    _, patch = cv2.connectedComponents(contact.astype(np.uint8), connectivity=8)
    if contact.any():
        pairs = np.unique(np.stack([lab[contact], patch[contact]], 1), axis=0)
        comps, counts = np.unique(pairs[:, 0], return_counts=True)
        hard |= np.isin(lab, comps[(counts >= ANCHORS) & (comps > 0)])
    return hard, thin


def _thin(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning to a one-pixel skeleton."""
    img = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p = [np.roll(np.roll(img, -dy, 0), -dx, 1) for dy, dx in
                 ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))]
            b = sum(p)
            seq = p + [p[0]]
            a = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c = (p[0] * p[2] * p[4] == 0) & (p[2] * p[4] * p[6] == 0)
            else:
                c = (p[0] * p[2] * p[6] == 0) & (p[0] * p[4] * p[6] == 0)
            kill = (img == 1) & (b >= 2) & (b <= 6) & (a == 1) & c
            if kill.any():
                img[kill] = 0
                changed = True
        if not changed:
            return img[1:-1, 1:-1] > 0


def door_arcs(thin: np.ndarray, seed: int = 0) -> list[tuple]:
    """Quarter-circle parts of the thin ink: (hinge, radius, end 1, end 2).
    The skeleton is split at its junctions; in each branch, a circle is fit
    with RANSAC, so a door leaf joined to its arc is an outlier, not a misfit."""
    side = max(thin.shape)
    sk = _thin(thin)
    if sk.sum() < 10:
        return []
    # A junction has three or more 0-to-1 steps around it.
    pad = np.pad(sk.astype(np.uint8), 1)
    ring = [pad[1 + dy:pad.shape[0] - 1 + dy, 1 + dx:pad.shape[1] - 1 + dx] for dy, dx in
            ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))]
    steps = sum(((ring[i] == 0) & (ring[(i + 1) % 8] == 1)).astype(np.uint8) for i in range(8))
    junction = sk & (steps >= 3)
    branches = sk & ~(cv2.dilate(junction.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
    n, lab = cv2.connectedComponents(branches.astype(np.uint8), connectivity=8)
    rng = np.random.default_rng(seed)
    out = []
    for i in range(1, n):
        ys, xs = np.nonzero(lab == i)
        if len(xs) < 0.6 * (np.pi / 2) * ARC_RADIUS[0] * side:
            continue
        pts = np.c_[xs, ys].astype(float)
        best = None
        for _ in range(60):
            a, b, c = pts[rng.choice(len(pts), 3, replace=False)]
            d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
            if abs(d) < 1e-6:
                continue
            ux = ((a @ a) * (b[1] - c[1]) + (b @ b) * (c[1] - a[1]) + (c @ c) * (a[1] - b[1])) / d
            uy = ((a @ a) * (c[0] - b[0]) + (b @ b) * (a[0] - c[0]) + (c @ c) * (b[0] - a[0])) / d
            r = float(np.hypot(*(a - (ux, uy))))
            if not (ARC_RADIUS[0] * side <= r <= ARC_RADIUS[1] * side):
                continue
            inl = np.abs(np.hypot(pts[:, 0] - ux, pts[:, 1] - uy) - r) <= max(2.0, ARC_FIT * r / 2)
            if best is None or inl.sum() > best[3].sum():
                best = (ux, uy, r, inl)
        if best is None:
            continue
        cx, cy, r, inl = best
        if inl.sum() < 0.6 * (np.pi / 2) * r:
            continue
        # The sweep: the largest gap between the angles of the arc is the part it does not cover.
        s_ = np.sort(np.arctan2(pts[inl, 1] - cy, pts[inl, 0] - cx))
        gaps = np.diff(np.r_[s_, s_[0] + 2 * np.pi])
        g = int(np.argmax(gaps))
        sweep = np.degrees(2 * np.pi - gaps[g])
        if not (ARC_SWEEP[0] <= sweep <= ARC_SWEEP[1]):
            continue
        a0, a1 = s_[(g + 1) % len(s_)], s_[g]
        out.append(((cx, cy), r, (cx + r * np.cos(a0), cy + r * np.sin(a0)), (cx + r * np.cos(a1), cy + r * np.sin(a1))))
    return out


def gap_bridges(walls: np.ndarray) -> np.ndarray:
    """Lines across the gaps in walls: two wall ends that face each other along
    one line (a door or an entrance). Two parallel walls are not joined, so the
    paper between two drawings stays open."""
    side = max(walls.shape)
    sk = _thin(walls)
    pad = np.pad(sk.astype(np.uint8), 1)
    nb = sum(pad[1 + dy:pad.shape[0] - 1 + dy, 1 + dx:pad.shape[1] - 1 + dx]
             for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)
    ends = np.argwhere(sk & (nb == 1))[:, ::-1].astype(float)  # (x, y)
    pts = np.argwhere(sk)[:, ::-1].astype(float)
    reach = BRIDGE_LOOK * side
    dirs = []
    for e in ends:
        near = pts[np.hypot(*(pts - e).T) <= reach]
        d = e - near.mean(0)  # the wall runs from its body to its end
        n = np.hypot(*d)
        dirs.append(d / n if n > 1e-6 else None)
    out = np.zeros(walls.shape, np.uint8)
    lim = BRIDGE_MAX * side
    cos = np.cos(np.radians(BRIDGE_ANGLE))
    for i in range(len(ends)):
        if dirs[i] is None:
            continue
        for j in range(i + 1, len(ends)):
            if dirs[j] is None:
                continue
            v = ends[j] - ends[i]
            L = np.hypot(*v)
            if not (2 < L <= lim):
                continue
            u = v / L
            if dirs[i] @ u >= cos and dirs[j] @ -u >= cos:
                cv2.line(out, tuple(map(int, ends[i])), tuple(map(int, ends[j])), 1, 3)
    return out > 0


def footprints(walls: np.ndarray, plan_box=None) -> np.ndarray | None:
    """One filled footprint for each drawing on the sheet, or None when no drawing is found."""
    side = max(walls.shape)
    m = (walls & ~outside_box(walls.shape, plan_box)).astype(np.uint8)
    m |= gap_bridges(m > 0).astype(np.uint8)
    k = max(3, int(CLOSE_SHARE * side))
    closed = m.copy()
    # A closing along each axis closes a door gap in a thin wall; a round kernel
    # closes only gaps much smaller than itself.
    for kernel in (np.ones((1, k), np.uint8), np.ones((k, 1), np.uint8)):
        closed |= cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
    cnts, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    floor = (~outside_box(walls.shape, plan_box)).sum()
    fp = np.zeros_like(m)
    for c in cnts:
        if cv2.contourArea(c) < MIN_DRAWING * floor:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        # An outline left open (an entrance wider than the closing) fills only
        # its own stroke: the convex hull stands in for that drawing.
        if cv2.contourArea(c) < MIN_FILL * bw * bh:
            c = cv2.convexHull(c)
        cv2.drawContours(fp, [c], -1, 1, -1)
    return fp > 0 if fp.any() else None


def ink_walls(img: np.ndarray, plan_box=None, boxes=None) -> tuple[np.ndarray, np.ndarray]:
    """The hard walls (with the outside of the drawings) and the soft lines."""
    side = max(img.shape[:2])
    ink = drawn_ink(img, plan_box, boxes)
    core, thin = split_strokes(ink, plan_box)
    grow = lambda m: cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    box_out = outside_box(ink.shape, plan_box)
    hard = grow(core) | box_out
    soft = grow(ink) & ~hard
    fp = footprints(hard | soft, plan_box)
    if fp is not None:
        hard |= ~fp
        soft &= fp
    cut = np.zeros(ink.shape, np.uint8)
    width = max(3, int(DOOR_CUT * side))
    for (cx, cy), _, e1, e2 in door_arcs(thin):
        for e in (e1, e2):
            cv2.line(cut, (round(cx), round(cy)), (round(e[0]), round(e[1])), 1, width)
    opened = (cut > 0) & ~box_out
    return hard & ~opened, soft & ~opened & ~hard
