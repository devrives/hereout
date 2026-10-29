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
quarter circle, with its hinge on a wall and a drawn leaf along one chord, is
a door swing; the other chord, the doorway, is cut out of the walls. A plan with only thin strokes keeps the long straight lines as
walls instead.

Each drawing on the sheet gets a footprint: the walls closed along each axis
(wider than a door), then filled. Everything outside every footprint is
closed, so a way never crosses the paper between two drawings or around one.
"""

from __future__ import annotations

import re
import threading

import cv2
import numpy as np

from .route import GRID_SIDE
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
EXIT_ROOM = 0.03            # share of the image: the paper around an exit that stays open
HINGE_NEAR = 3              # px: the hinge of a door arc is this close to a wall
WALL_STRIP = 0.007          # share of the image: the paper strip inside a double-line wall
LEAF_INK = 0.6              # share of a chord on ink that makes it a door leaf
EXIT_DOOR = 0.06            # share of the image: an exit gets a cut to a large open area this close
BIG_AREA = 0.05             # share of the open area: a large open area
FILL_DROP = 45              # grey levels below the paper: a fill, not paper
FILL_WIDTH = 0.008          # share of the image: a fill is at least this wide (lines and text are not)
FILL_MAX = 0.5              # fills over more of the open drawing than this are the floor, not fills
FILL_GAP = 0.009            # share of the image: a narrower paper gap between two fills is closed
FILL_AREA = 0.0004          # share of the image: a smaller dark patch is a mark (an arrow head), not a fill
GREEN_TINT = 3              # Lab a* steps below the paper: a green tint
PAPER_LOOK = 0.08           # share of the image: the window that finds the local paper tone
OUT_TOUCH = 0.01            # share of the image: an open area that touches the edge of the drawing this long, with no wall,
OUT_SHARE = 0.25            # and along this share of its border, is outside the building
EXIT_OFF = 0.1              # share of the image: an exit farther than this from every drawing is not on the plan
MINOR_DRAWING = 0.3         # share of the largest footprint: a smaller one is a minor drawing
EXIT_MOVE = 0.1             # share of the image: an exit outside the building moves to the building this close
OUT_DEPTH = 0.15            # share of the image: the deepest that an area beyond the exits goes from the edge of the drawing
ROOM_MIN = 0.0004           # share of the image: a closed area this large is a room and gets a door
ROOM_WIDTH = 0.025          # share of the image: the mean width of a room that gets a door
ROOM_DOOR = 0.025           # share of the image: the thickest wall that such a door goes through
OUTDOOR_MIN = 0.004         # share of the image: a smaller open area is a room, and its word is a name
OUTDOOR_MAX = 0.4           # share of the open drawing: a larger area is the building, joined to the word by a gap
OUTDOOR_READS = 3           # the widest text lines of each area that are read: the area name is a wide line

# Words that name an open area outside the building: a roof, a yard, a
# street, a car park. Short words match whole; the others match at the start
# of a word ("Dachfläche", "Parkplatz"). "Terrace" is not here: a terrace is
# often a way out. The OCR model reads Latin script and Chinese characters.
OUTDOOR_WORDS = re.compile(
    r"\b(?:rue|cour|hof|dak|patio|calle|rua|yard|lawn)\b"
    r"|\b(?:dach|stra(?:ss|ß)e|street|road|alley|parking|car ?park|courtyard|garden|roof|playground|sidewalk"
    r"|innenhof|garten|parkplatz|gasse|jardin|jardim|toiture|cortile|giardino|parcheggio|strada|tetto"
    r"|azotea|telhado|estacionamient|estacionament|aparcamient|straat|tuin|binnenplaats)"
    r"|屋顶|屋頂|屋上|道路|马路|馬路|停车场|停車場|駐車場|庭院|中庭|花园|花園|庭園|天台",
    re.IGNORECASE)

_ocr = None
_rec = None
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


def read_texts(crops: list[np.ndarray]) -> list[str]:
    """The text of each crop of one text line (RapidOCR recognition, no detection)."""
    global _rec
    out = []
    with _ocr_lock:
        if _rec is None:
            from rapidocr import RapidOCR
            _rec = RapidOCR(params={"Global.use_cls": False, "Global.log_level": "error"})
        for c in crops:
            r = _rec(c, use_det=False, use_cls=False, use_rec=True)
            out.append(r.txts[0] if r.txts else "")
    return out


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
    n, lab, st, _ = cv2.connectedComponentsWithStats(branches.astype(np.uint8), connectivity=8)
    rng = np.random.default_rng(seed)
    out = []
    # The points of each branch, found in one pass (a plan has thousands of branches).
    ys, xs = np.nonzero(lab)
    order = np.argsort(lab[ys, xs], kind="stable")
    ys, xs = ys[order], xs[order]
    start = np.r_[0, np.cumsum(st[1:, cv2.CC_STAT_AREA])]
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 0.6 * (np.pi / 2) * ARC_RADIUS[0] * side:
            continue
        pts = np.c_[xs[start[i - 1]:start[i]], ys[start[i - 1]:start[i]]].astype(float)
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


def _share(mask: np.ndarray, a, b) -> float:
    """The share of the middle of segment a-b that lies on the mask."""
    t = np.linspace(0.15, 0.85, 24)
    xs = np.clip(np.round(a[0] + (b[0] - a[0]) * t).astype(int), 0, mask.shape[1] - 1)
    ys = np.clip(np.round(a[1] + (b[1] - a[1]) * t).astype(int), 0, mask.shape[0] - 1)
    return float(mask[ys, xs].mean())


def door_openings(thin: np.ndarray, hard: np.ndarray, ink: np.ndarray) -> list[tuple]:
    """The doorways of the door arcs: (hinge, end) segments. An arc is a door
    only when its hinge is on a wall and one of its two chords is a door leaf
    (drawn ink); the other chord is the doorway. Circles of symbols fail this,
    so they cut no hole in a wall."""
    side = max(thin.shape)
    near = cv2.dilate(hard.astype(np.uint8), np.ones((2 * HINGE_NEAR + 1, 2 * HINGE_NEAR + 1), np.uint8)) > 0
    grown = cv2.dilate(ink.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    out = []
    for (cx, cy), r, e1, e2 in door_arcs(thin):
        hx, hy = int(round(cx)), int(round(cy))
        if not (0 <= hx < hard.shape[1] and 0 <= hy < hard.shape[0]) or not near[hy, hx]:
            continue
        c1, c2 = _share(grown, (cx, cy), e1), _share(grown, (cx, cy), e2)
        leaf, gap = (e1, e2) if c1 >= c2 else (e2, e1)
        if max(c1, c2) < LEAF_INK:
            continue
        out.append(((cx, cy), gap))
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


def ink_walls(img: np.ndarray, plan_box=None, boxes=None, exits=()) -> tuple[np.ndarray, np.ndarray, list]:
    """The hard walls (with the outside of the drawings), the soft lines, and
    the exits as placed on the drawing (place_exits; None for a dropped exit).
    exits: (x, y) points; the paper just around each exit stays open, because
    an exit mark often sits just outside the outer wall, at its door."""
    side = max(img.shape[:2])
    boxes = text_boxes(img) if boxes is None else boxes
    ink = drawn_ink(img, plan_box, boxes)
    core, thin = split_strokes(ink, plan_box)
    # A wall drawn as two thin lines has a strip of paper inside it: close it.
    k = max(3, int(WALL_STRIP * side)) | 1
    core = cv2.morphologyEx(core.astype(np.uint8), cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
    grow = lambda m: cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    box_out = outside_box(ink.shape, plan_box)
    base = grow(core) | box_out
    fill = fills(img, plan_box, boxes, exits)
    hard = base | fill
    soft = grow(ink) & ~hard
    placed = [(float(x), float(y)) for x, y in exits]
    fp = footprints(hard | soft, plan_box)
    # Fills over most of the open drawing are the floor itself (a plan
    # behind tinted glass on white paper): the plan has no fills.
    if fill.any() and fp is not None:
        open_ = fp & ~base
        if (fill & open_).sum() > FILL_MAX * max(1, open_.sum()):
            hard = base
            soft = grow(ink) & ~hard
            fp = footprints(hard | soft, plan_box)
    if fp is not None:
        near_exit = np.zeros(ink.shape, np.uint8)
        for x, y in placed:
            cv2.circle(near_exit, (round(x), round(y)), max(3, int(EXIT_ROOM * side)), 1, -1)
        out = outside_areas(hard | soft | ~fp, ~fp & ~box_out, near_exit > 0)
        out |= beyond_exits(hard | soft | ~fp | out, fp, placed)
        out |= outdoor_areas(img, hard | soft | ~fp | out, boxes)
        placed = place_exits(placed, fp, hard | ~fp | out)
        disc = np.zeros(ink.shape, np.uint8)
        for x, y in (p for p in placed if p is not None):
            cv2.circle(disc, (round(x), round(y)), max(3, int(EXIT_ROOM * side)), 1, -1)
        hard |= (~fp | out) & (disc == 0)
        soft &= ~hard
    cut = np.zeros(ink.shape, np.uint8)
    width = max(3, int(DOOR_CUT * side))
    for (cx, cy), e in door_openings(thin, core, ink):
        cv2.line(cut, (round(cx), round(cy)), (round(e[0]), round(e[1])), 1, width)
    opened = (cut > 0) & ~box_out
    hard, soft = hard & ~opened, soft & ~opened & ~hard
    kept = [p for p in placed if p is not None]
    hard &= ~exit_doors(hard, kept)
    hard &= ~room_doors(hard, kept, None if fp is None else ~fp | box_out)
    return hard, soft & ~hard, placed


def fills(img: np.ndarray, plan_box=None, boxes=None, exits=()) -> np.ndarray:
    """Grey areas that are much darker than the paper around them and wider
    than a line: track beds, shafts, solid walls. A route never crosses them.
    Coloured areas are not fills: those are signs and marked zones. Some
    plans draw the floor itself in grey on a light sign: when most exits
    stand on the dark tone, that tone is the floor, and the plan has no fills."""
    side = max(img.shape[:2])
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # The paper tone on a small copy: the windows are wide, and the tone changes slowly.
    f = 8
    small = cv2.resize(cv2.dilate(grey, np.ones((f, f), np.uint8)), (max(1, grey.shape[1] // f), max(1, grey.shape[0] // f)),
                       interpolation=cv2.INTER_NEAREST)
    k = max(3, int(PAPER_LOOK * side / f)) | 1
    paper = cv2.resize(cv2.GaussianBlur(cv2.dilate(small, np.ones((k, k), np.uint8)), (k, k), 0),
                       (grey.shape[1], grey.shape[0]), interpolation=cv2.INTER_LINEAR)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    bright = grey >= np.percentile(grey, 70)
    # A green tint is a printed route band (ISO 7010 green), not a fill.
    green = lab[..., 1].astype(np.int16) < np.median(lab[..., 1][bright]) - GREEN_TINT
    dark = (paper.astype(np.int16) - grey > FILL_DROP) & (_chroma(img) <= CHROMA) & ~green
    for bx in boxes or []:
        p = np.int32(bx)
        x0, y0 = p.min(0) - TEXT_PAD
        x1, y1 = p.max(0) + TEXT_PAD
        dark[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = False
    w = max(3, int(FILL_WIDTH * side)) | 1
    solid = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (w, w)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    big = st[:, cv2.CC_STAT_AREA] >= FILL_AREA * solid.size
    big[0] = False
    out = big[lab]
    # A thin paper ribbon between two fills (the border of a printed panel)
    # is not a way: it goes with the fills.
    g = max(3, int(FILL_GAP * side)) | 1
    out = cv2.morphologyEx(out.astype(np.uint8), cv2.MORPH_CLOSE,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (g, g))) > 0
    out &= ~outside_box(img.shape, plan_box)
    r = max(3, int(EXIT_ROOM * side))
    on_fill = 0
    for x, y in exits:
        disc = np.zeros(out.shape, np.uint8)
        cv2.circle(disc, (round(x), round(y)), r, 1, -1)
        on_fill += dark[disc > 0].mean() > 0.5 if disc.any() else 0
    if len(exits) and on_fill > len(exits) / 2:
        return np.zeros(out.shape, bool)
    return out


def outside_areas(blocked: np.ndarray, edge: np.ndarray, keep: np.ndarray | None = None) -> np.ndarray:
    """Open areas that touch the edge of the drawing with no line between:
    the street, a forecourt, a margin of the sheet. A room has a line all
    round (a wall, or a thin outline), so its open area never touches the edge itself.
    edge: True outside the drawings (the plan box margin does not count).
    keep: True round the exits; an area that touches it is the way to an
    exit, and stays (its outer wall can be a thin line that the photo lost)."""
    side = max(blocked.shape)
    free = (~blocked).astype(np.uint8)
    n, lab = cv2.connectedComponents(free, connectivity=4)
    k = np.ones((3, 3), np.uint8)
    border = (cv2.erode(free, k) == 0) & (free > 0)
    touch = border & (cv2.dilate(edge.astype(np.uint8), k) > 0)
    t = np.bincount(lab[touch], minlength=n)
    b = np.bincount(lab[border], minlength=n)
    out = (t >= OUT_TOUCH * side) & (t >= OUT_SHARE * np.maximum(b, 1))
    out[0] = False
    if keep is not None:
        out[np.unique(lab[keep])] = False
    return out[lab]


def beyond_exits(blocked: np.ndarray, inside: np.ndarray, exits) -> np.ndarray:
    """The open areas on the far side of the exits: a pavement, a forecourt,
    a canopy. An exit is a door in the outer wall. Its outer side is the side
    that is nearer to the edge of the drawing. An area that more exits have
    on their outer side than on their inner side, and that stays near the
    edge, is outside the building. The thin lines count as borders here, so a
    door in the outer wall does not join the street to the hall.
    inside: True on the drawings."""
    side = max(blocked.shape)
    h, w = blocked.shape
    r = max(3, int(EXIT_ROOM * side))
    cut = blocked.astype(np.uint8)
    for x, y in (p for p in exits if p is not None):
        cv2.circle(cut, (round(x), round(y)), r, 1, -1)
    n, lab, st, _ = cv2.connectedComponentsWithStats(1 - cut, connectivity=4)
    depth = cv2.distanceTransform(cv2.copyMakeBorder(inside.astype(np.uint8), 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0),
                                  cv2.DIST_L2, 5)[1:-1, 1:-1]
    far = OUT_DEPTH * side
    gap = max(3, r // 4)   # the areas just past the cut round each exit
    votes = np.zeros(n, int)
    for x, y in (p for p in exits if p is not None):
        cx, cy = round(x), round(y)
        if not (0 <= cx < w and 0 <= cy < h):
            continue
        rays = []
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            edge, comp = None, 0
            for t in range(1, int(far) + 1):
                px, py = cx + dx * t, cy + dy * t
                if not (0 <= px < w and 0 <= py < h) or not inside[py, px]:
                    edge = t
                    break
                if not comp and r < t <= r + gap and lab[py, px]:
                    comp = lab[py, px]
            rays.append((edge if edge is not None else np.inf, comp))
        k = int(np.argmin([e for e, _ in rays]))
        if not np.isfinite(rays[k][0]):
            continue
        outer, inner = rays[k][1], rays[k ^ 1][1]
        # The building is the larger side. A stair exit inside a platform has
        # the small stair box on one side and the platform on the other.
        if outer and inner and outer != inner:
            votes[inner] -= 1
            if st[inner, cv2.CC_STAT_AREA] >= st[outer, cv2.CC_STAT_AREA]:
                votes[outer] += 1
    votes[0] = 0
    out = votes > 0
    free = st[1:, cv2.CC_STAT_AREA].sum()
    for c in np.nonzero(out)[0]:
        if st[c, cv2.CC_STAT_AREA] > 0.5 * free or depth[lab == c].max() > far:
            out[c] = False
    # The thin lines between two outside areas go with them.
    return cv2.dilate(out[lab].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0


def outdoor_areas(img: np.ndarray, blocked: np.ndarray, boxes) -> np.ndarray:
    """Open areas that a word names as outside: "Dachfläche" on a roof,
    "STREET" on a street inside the site outline. Only the widest text lines
    in large open areas are read, so the reading stays short."""
    h, w = blocked.shape
    n, lab, st, _ = cv2.connectedComponentsWithStats((~blocked).astype(np.uint8), connectivity=4)
    area = st[:, cv2.CC_STAT_AREA]
    total = area[1:].sum()
    lines: dict[int, list] = {}
    for bx in boxes or []:
        p = np.int32(bx)
        x0, y0 = np.maximum(p.min(0), 0)
        x1, y1 = p.max(0)
        cx, cy = min(w - 1, (x0 + x1) // 2), min(h - 1, (y0 + y1) // 2)
        c = lab[cy, cx]
        if c and OUTDOOR_MIN * h * w <= area[c] <= OUTDOOR_MAX * total and x1 > x0 and y1 > y0:
            lines.setdefault(c, []).append((x0, y0, x1, y1))
    crops, owners = [], []
    for c, found in lines.items():
        for x0, y0, x1, y1 in sorted(found, key=lambda b: b[0] - b[2])[:OUTDOOR_READS]:
            crops.append(img[y0:y1, x0:x1])
            owners.append(c)
    out = np.zeros(n, bool)
    for c, t in zip(owners, read_texts(crops)):
        if OUTDOOR_WORDS.search(t):
            out[c] = True
    return out[lab]


def place_exits(exits: list, fp: np.ndarray, blocked: np.ndarray) -> list:
    """Each exit, or None when it is not on any drawing (a text panel, a
    legend). An exit on an open area outside the building moves to the
    nearest open point of the building. At least one exit stays."""
    side = max(fp.shape)
    h, w = fp.shape
    near = cv2.distanceTransform((~fp).astype(np.uint8), cv2.DIST_L2, 5)
    inside = (~blocked).astype(np.uint8)
    to_in = cv2.distanceTransform(1 - inside, cv2.DIST_L2, 5)
    out = []
    for x, y in exits:
        cx, cy = min(w - 1, max(0, round(x))), min(h - 1, max(0, round(y)))
        if near[cy, cx] > EXIT_OFF * side:
            out.append(None)
        elif to_in[cy, cx] > EXIT_ROOM * side and to_in[cy, cx] <= EXIT_MOVE * side:
            r = int(to_in[cy, cx]) + 2
            y0, x0 = max(0, cy - r), max(0, cx - r)
            ys, xs = np.nonzero(inside[y0:cy + r + 1, x0:cx + r + 1])
            i = int(np.argmin((xs + x0 - cx) ** 2 + (ys + y0 - cy) ** 2))
            out.append((float(xs[i] + x0), float(ys[i] + y0)))
        else:
            out.append((x, y))
    # A lone exit on a small drawing apart from the main one is a sign on a
    # text panel (its boxes close into a footprint), not a second building.
    n, lab, st, _ = cv2.connectedComponentsWithStats(fp.astype(np.uint8), connectivity=8)
    if n > 2:
        # Each exit goes with the footprint it is on, or the nearest one.
        _, nearest = cv2.distanceTransformWithLabels((~fp).astype(np.uint8), cv2.DIST_L2, 5,
                                                     labelType=cv2.DIST_LABEL_PIXEL)
        ys, xs = np.nonzero(fp)
        order = np.zeros(nearest.max() + 1, np.int32)
        order[nearest[ys, xs]] = lab[ys, xs]
        where = [order[nearest[min(h - 1, max(0, round(p[1]))), min(w - 1, max(0, round(p[0])))]] if p else 0
                 for p in out]
        count = np.bincount(where, minlength=n)
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        main = st[big, cv2.CC_STAT_AREA]
        # A part of the building that the closing split off (the middle of a
        # hall) lies inside the bounds of the main drawing; a text panel does not.
        bx, by, bw, bh = st[big, :4]
        for i, c in enumerate(where):
            cx, cy = st[c, 0] + st[c, 2] / 2, st[c, 1] + st[c, 3] / 2
            inside = bx <= cx <= bx + bw and by <= cy <= by + bh
            if c and count[c] == 1 and st[c, cv2.CC_STAT_AREA] < MINOR_DRAWING * main and count[1:].sum() > 1 \
                    and not inside:
                out[i] = None
    if exits and all(p is None for p in out):
        return [(float(x), float(y)) for x, y in exits]
    return out


def room_doors(hard: np.ndarray, exits, edge: np.ndarray | None) -> np.ndarray:
    """A door into each closed room. Every room of a building has a door, but
    a door drawn as a thin line, or covered by a sign, reads as wall. A room
    that no exit reaches gets a cut through the thinnest wall to an area that
    an exit reaches, then the next rooms, until no room is left or the walls
    are too thick. edge: True outside the drawings; a cut never goes there."""
    side = max(hard.shape)
    out = np.zeros(hard.shape, np.uint8)
    if not len(exits):
        return out > 0
    k = max(3, int(np.ceil(side / GRID_SIDE)) * 2 + 1)
    width = max(k + 2, int(DOOR_CUT * side))
    free = cv2.erode((~hard).astype(np.uint8), np.ones((k, k), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    reached = np.zeros(n, bool)
    h, w = hard.shape
    r = max(3, int(EXIT_ROOM * side))
    for x, y in exits:
        cx, cy = int(round(x)), int(round(y))
        win = lab[max(0, cy - r):cy + r + 1, max(0, cx - r):cx + r + 1]
        reached[np.unique(win)] = True
    reached[0] = False
    # A room is wide; a thin strip (the margin between a drawing and its
    # frame, the paper inside a double wall) is not, and gets no door.
    wide = st[:, cv2.CC_STAT_AREA] / np.maximum(1, np.maximum(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT]))
    room = (st[:, cv2.CC_STAT_AREA] >= ROOM_MIN * h * w) & (wide >= ROOM_WIDTH * side)
    room[0] = False
    reach = ROOM_DOOR * side + k
    for _ in range(64):
        todo = np.nonzero(room & ~reached)[0]
        if not len(todo) or not reached.any():
            break
        dist = cv2.distanceTransform((~reached[lab]).astype(np.uint8), cv2.DIST_L2, 5)
        opened = False
        for c in todo:
            bx, by, bw, bh = st[c, :4]
            d = np.where(lab[by:by + bh, bx:bx + bw] == c, dist[by:by + bh, bx:bx + bw], np.inf)
            i = int(np.argmin(d))
            if d.flat[i] > reach:
                continue
            py, px = divmod(i, bw)
            py, px = py + by, px + bx
            rr = int(d.flat[i]) + 2
            y0, x0 = max(0, py - rr), max(0, px - rr)
            ys, xs = np.nonzero(reached[lab[y0:py + rr + 1, x0:px + rr + 1]])
            j = int(np.argmin((xs + x0 - px) ** 2 + (ys + y0 - py) ** 2))
            qx, qy = int(xs[j] + x0), int(ys[j] + y0)
            m = width + 1
            wx0, wy0 = max(0, min(px, qx) - m), max(0, min(py, qy) - m)
            wx1, wy1 = min(w, max(px, qx) + m + 1), min(h, max(py, qy) + m + 1)
            line = np.zeros((wy1 - wy0, wx1 - wx0), np.uint8)
            cv2.line(line, (px - wx0, py - wy0), (qx - wx0, qy - wy0), 1, width)
            if edge is not None and (edge[wy0:wy1, wx0:wx1] & (line > 0)).any():
                continue
            out[wy0:wy1, wx0:wx1] |= line
            reached[c] = True
            opened = True
        if not opened:
            break
    return out > 0


def exit_doors(hard: np.ndarray, exits) -> np.ndarray:
    """A narrow cut from each exit to the nearest large open area. An exit is a
    door in the outer wall, and its mark often sits on the wall ink or just
    outside it; without the cut it reaches only a pocket of paper."""
    side = max(hard.shape)
    out = np.zeros(hard.shape, np.uint8)
    if not len(exits):
        return out > 0
    # Open space as the route grid sees it: a gap narrower than a grid cell is closed.
    k = max(3, int(np.ceil(side / GRID_SIDE)) * 2 + 1)
    free = cv2.erode((~hard).astype(np.uint8), np.ones((k, k), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    big = np.zeros(n, bool)
    big[1:] = st[1:, cv2.CC_STAT_AREA] >= BIG_AREA * free.sum()
    if not big.any():
        return out > 0
    reach = int(EXIT_DOOR * side)
    width = max(3, int(DOOR_CUT * side))
    h, w = hard.shape
    for x, y in exits:
        cx, cy = int(round(x)), int(round(y))
        x0, y0, x1, y1 = max(0, cx - reach), max(0, cy - reach), min(w, cx + reach + 1), min(h, cy + reach + 1)
        win = big[lab[y0:y1, x0:x1]]
        if not win.any():
            continue
        if 0 <= cy < h and 0 <= cx < w and big[lab[cy, cx]]:
            continue  # the exit is already on a large open area
        ys, xs = np.nonzero(win)
        i = int(np.argmin((xs + x0 - cx) ** 2 + (ys + y0 - cy) ** 2))
        cv2.line(out, (cx, cy), (int(xs[i] + x0), int(ys[i] + y0)), 1, max(width, k + 2))
    return out > 0
