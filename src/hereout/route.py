"""Find the way from any open spot on the plan to the nearest exit.

The wall mask is shrunk to a coarse grid. A cell is blocked when enough of it
is wall. The escape field holds, for every open cell, the cost of the cheapest
way to an exit and the next cell on that way. It is found once, with Dijkstra
from all exits at the same time, so a route from any start is a walk along
the "next" cells. Cells close to a wall cost a little more, so the routes keep
to the middle of corridors and doors.

web/route.js does the same steps in the same order, so the browser gets the
same field from the same grid (tests/test_route_parity.py). Change both.
"""

from __future__ import annotations

import base64
import heapq
import math
from dataclasses import dataclass

import cv2
import numpy as np

GRID_SIDE = 320          # cells on the longest side
BLOCK_SHARE = 0.25       # share of wall pixels that blocks a cell
SNAP_SHARE = 0.06        # a mark may move this share of the grid to a free cell
MARK_CLEAR_SHARE = 0.012 # the ink of a mark itself is not a wall within this radius
SOFT_COST = 10.0         # extra cost of a cell on a soft line (a door swing, a dash): passable, not wanted
SOFT_SHARE = 0.15        # share of soft-line pixels that makes a cell soft
EXIT_REACH_SHARE = 0.015 # an exit reaches the open cells this close, on each side of the line it is on
WALL_COST = 2.0          # extra cost next to a wall, fading with distance
AXIS_RANGE = 20.0        # degrees from the image axes that a main wall direction can be
AXIS_LINE = 0.04         # share of the long side: the shortest wall edge that counts for the directions
AXIS_SHARE = 0.25        # share of the edge length near an axis that must agree on one direction
AXIS_MIN = 0.4           # degrees; a smaller tilt counts as 0
AXIS_SHEAR = 10.0        # degrees; the most that the two main directions differ in tilt
SQRT2 = math.sqrt(2)
# Chamfer weights of a 3x3 distance transform that is close to Euclidean.
CHAMFER_A, CHAMFER_B = 0.955, 1.3693
FAR = 1e9
NEIGHBOURS = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
              (-1, -1, SQRT2), (-1, 1, SQRT2), (1, -1, SQRT2), (1, 1, SQRT2)]


@dataclass
class Route:
    points: list[tuple[float, float]]  # image pixels, start first
    exit_index: int                    # which exit the route reaches
    length_px: float


class NoRoute(Exception):
    pass


def blocked_grid(walls: np.ndarray) -> tuple[np.ndarray, float]:
    """The coarse grid of blocked cells, and image pixels to cells."""
    h, w = walls.shape
    scale = GRID_SIDE / max(h, w)
    gw, gh = max(1, round(w * scale)), max(1, round(h * scale))
    share = cv2.resize(walls.astype(np.float32), (gw, gh), interpolation=cv2.INTER_AREA)
    return share >= BLOCK_SHARE, scale


def pack(cells: np.ndarray) -> str:
    return base64.b64encode(np.packbits(cells.ravel().astype(np.uint8)).tobytes()).decode()


def soft_grid(soft: np.ndarray, blocked: np.ndarray) -> np.ndarray:
    """The open cells on a soft line (a door swing, a dash), from the soft-line pixels."""
    gh, gw = blocked.shape
    share = cv2.resize(soft.astype(np.float32), (gw, gh), interpolation=cv2.INTER_AREA)
    return (share >= SOFT_SHARE) & ~blocked


def grid_payload(walls: np.ndarray, soft: np.ndarray | None = None) -> dict:
    """The grid for the browser: blocked cells as packed bits, first bit high.
    With soft lines, "soft" has the soft cells in the same form. "axes" are
    the two main directions of the walls (wall_axes)."""
    blocked, scale = blocked_grid(walls)
    gh, gw = blocked.shape
    out = {"w": gw, "h": gh, "scale": scale, "bits": pack(blocked), "axes": list(wall_axes(walls))}
    if soft is not None and soft.any():
        out["soft"] = pack(soft_grid(soft, blocked))
    return out


def wall_axes(walls: np.ndarray) -> tuple[float, float]:
    """The two main directions of the walls, in radians: the tilt of the walls
    near the x axis and the tilt of the walls near the y axis. The way network
    of web/route.js draws its lines along them. A photo taken at an angle
    tilts the two by different amounts, by at most AXIS_SHEAR. A direction
    that few long wall edges agree on, or a tilt smaller than AXIS_MIN,
    counts as 0."""
    mask = walls.astype(np.uint8) * 255
    edges = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    side = max(mask.shape)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 720, threshold=40,
                            minLineLength=max(8, int(side * AXIS_LINE)), maxLineGap=3)
    if lines is None:
        return 0.0, 0.0
    x1, y1, x2, y2 = lines.reshape(-1, 4).T.astype(np.float64)
    angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
    length = np.hypot(x2 - x1, y2 - y1)

    def tilt(shift: float, around: float = 0.0, width: float = AXIS_RANGE) -> tuple[float, float] | None:
        """The main tilt in degrees of the edges near one axis, within width
        of around, and the edge length that agrees on it."""
        a = (angle - shift + 90) % 180 - 90
        near = np.abs(a - around) <= width
        if not near.any():
            return None
        bins = np.arange(around - width, around + width + 0.25, 0.25)
        hist, edges_ = np.histogram(a[near], bins=bins, weights=length[near])
        k = int(np.convolve(hist, [1, 2, 3, 2, 1], "same").argmax())
        top = (edges_[k] + edges_[k + 1]) / 2
        peak = near & (np.abs(a - top) < 1)
        if length[peak].sum() < AXIS_SHARE * length[near].sum():
            return None
        return float(np.average(a[peak], weights=length[peak])), float(length[peak].sum())

    x, y = tilt(0.0), tilt(90.0)
    # With no clear direction near one axis, that axis is square to the other.
    tx, ty = (x or y or (0.0, 0.0))[0], (y or x or (0.0, 0.0))[0]
    # A photo at an angle shears the two directions a little. More shear is
    # a wing of the building at an angle: the direction with more wall
    # edges leads, and the other one is found near it.
    if x and y and abs(tx - ty) > AXIS_SHEAR:
        if x[1] >= y[1]:
            near = tilt(90.0, tx, AXIS_SHEAR)
            ty = near[0] if near else tx
        else:
            near = tilt(0.0, ty, AXIS_SHEAR)
            tx = near[0] if near else ty
    return tuple(0.0 if abs(t) < AXIS_MIN else math.radians(t) for t in (tx, ty))


def wall_distance(blocked: np.ndarray) -> list[float]:
    """Chamfer distance of each cell to the nearest blocked cell, row by row."""
    gh, gw = blocked.shape
    d = [0.0 if b else FAR for b in blocked.ravel().tolist()]
    fwd = [(0, -1, CHAMFER_A), (-1, -1, CHAMFER_B), (-1, 0, CHAMFER_A), (-1, 1, CHAMFER_B)]
    back = [(0, 1, CHAMFER_A), (1, 1, CHAMFER_B), (1, 0, CHAMFER_A), (1, -1, CHAMFER_B)]
    for rows, cols, mask in ((range(gh), range(gw), fwd),
                             (range(gh - 1, -1, -1), range(gw - 1, -1, -1), back)):
        for r in rows:
            for c in cols:
                i = r * gw + c
                best = d[i]
                for dr, dc, wgt in mask:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < gh and 0 <= nc < gw:
                        v = d[nr * gw + nc] + wgt
                        if v < best:
                            best = v
                d[i] = best
    return d


class Field:
    """Cost to the nearest exit and the next cell, for every open cell."""

    def __init__(self, blocked: np.ndarray, scale: float,
                 exits: list[tuple[float, float]], clear: list[tuple[float, float]] = (),
                 soft: np.ndarray | None = None):
        self.scale = scale
        self.exits = list(exits)
        gh, gw = blocked.shape
        self.gw, self.gh = gw, gh
        # A start can sit on ink, for example the plan's own "you are here"
        # dot. Clear a small disc so the mark does not wall in its own point. An exit gets no disc: it is often on
        # a wall line, and a disc would cut a door into the wall. It snaps to
        # the nearest open cell instead.
        blocked = blocked.copy()
        radius = MARK_CLEAR_SHARE * max(gw, gh)
        for x, y in clear:
            r0, c0 = self.to_cell((x, y))
            span = int(radius) + 1
            for r in range(max(0, r0 - span), min(gh, r0 + span + 1)):
                for c in range(max(0, c0 - span), min(gw, c0 + span + 1)):
                    if (r - r0) ** 2 + (c - c0) ** 2 <= radius * radius:
                        blocked[r, c] = False
        self.blocked = blocked.ravel().tolist()
        wd = wall_distance(blocked)
        self.cost = [1.0 + WALL_COST / (1.0 + v) for v in wd]
        # A soft line (a door swing, a dash) can be crossed, at a cost.
        if soft is not None:
            for i in np.flatnonzero(soft.ravel()):
                self.cost[i] += SOFT_COST
        self.dist = [math.inf] * (gw * gh)
        self.next = [-1] * (gw * gh)
        self.owner = [-1] * (gw * gh)  # the exit each cell leads to

        if not self.exits:
            return
        heap: list[tuple[float, int]] = []
        for k, e in enumerate(self.exits):
            for g, d in self.exit_cells(e):
                if d < self.dist[g]:
                    self.dist[g] = d
                    self.owner[g] = k
                    heap.append((d, g))
        heapq.heapify(heap)
        dist, nxt, owner, cost, blk = self.dist, self.next, self.owner, self.cost, self.blocked
        while heap:
            d, i = heapq.heappop(heap)
            if d > dist[i]:
                continue
            r, c = divmod(i, gw)
            # Walking from a neighbour into this cell costs this cell's cost.
            step_cost = cost[i]
            for dr, dc, step in NEIGHBOURS:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < gh and 0 <= nc < gw):
                    continue
                j = nr * gw + nc
                if blk[j]:
                    continue
                # No corner cutting through the gap between two diagonal walls.
                if dr and dc and (blk[r * gw + nc] or blk[nr * gw + c]):
                    continue
                nd = d + step * step_cost
                if nd < dist[j]:
                    dist[j] = nd
                    nxt[j] = i
                    owner[j] = owner[i]
                    heapq.heappush(heap, (nd, j))

    def to_cell(self, xy: tuple[float, float]) -> tuple[int, int]:
        c = min(self.gw - 1, max(0, int(xy[0] * self.scale)))
        r = min(self.gh - 1, max(0, int(xy[1] * self.scale)))
        return r, c

    def to_px(self, i: int) -> tuple[float, float]:
        r, c = divmod(i, self.gw)
        return ((c + 0.5) / self.scale, (r + 0.5) / self.scale)

    def snap(self, xy: tuple[float, float]) -> int | None:
        """The cell of a point, or the nearest open cell when it is in a wall."""
        r0, c0 = self.to_cell(xy)
        if not self.blocked[r0 * self.gw + c0]:
            return r0 * self.gw + c0
        limit = SNAP_SHARE * max(self.gw, self.gh)
        span = int(limit)
        best, best_d2 = None, math.inf
        for r in range(max(0, r0 - span), min(self.gh, r0 + span + 1)):
            for c in range(max(0, c0 - span), min(self.gw, c0 + span + 1)):
                d2 = (r - r0) ** 2 + (c - c0) ** 2
                if d2 < best_d2 and not self.blocked[r * self.gw + c]:
                    best, best_d2 = r * self.gw + c, d2
        if best is None or math.sqrt(best_d2) > limit:
            return None
        return best

    def exit_cells(self, e: tuple[float, float]) -> list[tuple[int, float]]:
        """The open cells that an exit reaches at once, with their distance in cells.
        An exit mark is often on a wall line or just outside it: it reaches the open
        cells near it on each side, so no hole is cut in the wall. With no open
        cell that close, the exit snaps to the nearest open cell."""
        r0, c0 = self.to_cell(e)
        reach = EXIT_REACH_SHARE * max(self.gw, self.gh)
        span = int(reach)
        out = []
        for r in range(max(0, r0 - span), min(self.gh, r0 + span + 1)):
            for c in range(max(0, c0 - span), min(self.gw, c0 + span + 1)):
                d = math.sqrt((r - r0) ** 2 + (c - c0) ** 2)
                if d <= reach and not self.blocked[r * self.gw + c]:
                    out.append((r * self.gw + c, d))
        if out:
            return out
        g = self.snap(e)
        return [] if g is None else [(g, 0.0)]

    def route(self, start: tuple[float, float]) -> Route:
        if not self.exits:
            raise NoRoute("no exits")
        if all(o < 0 for o in self.owner):
            raise NoRoute("every exit is inside a wall")
        s = self.snap(start)
        if s is None:
            raise NoRoute("start is inside a wall")
        if self.owner[s] < 0:
            raise NoRoute("no open way to an exit")
        cells = [s]
        while self.next[cells[-1]] >= 0:
            cells.append(self.next[cells[-1]])
        k = self.owner[s]
        pts = [self.to_px(i) for i in cells]
        pts[0] = tuple(start)
        if len(pts) == 1:
            pts.append(self.exits[k])
        else:
            pts[-1] = tuple(self.exits[k])
        length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        return Route(points=pts, exit_index=k, length_px=length)


def find_route(walls: np.ndarray, start: tuple[float, float],
               exits: list[tuple[float, float]]) -> Route:
    """Return the cheapest route from start to any exit, in image pixels."""
    if not exits:
        raise NoRoute("no exits")
    blocked, scale = blocked_grid(walls)
    return Field(blocked, scale, exits, clear=[start]).route(start)
