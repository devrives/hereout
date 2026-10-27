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
WALL_COST = 2.0          # extra cost next to a wall, fading with distance
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


def grid_payload(walls: np.ndarray) -> dict:
    """The grid for the browser: blocked cells as packed bits, first bit high."""
    blocked, scale = blocked_grid(walls)
    gh, gw = blocked.shape
    bits = np.packbits(blocked.ravel().astype(np.uint8))
    return {"w": gw, "h": gh, "scale": scale, "bits": base64.b64encode(bits.tobytes()).decode()}


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
                 exits: list[tuple[float, float]], clear: list[tuple[float, float]] = ()):
        self.scale = scale
        self.exits = list(exits)
        gh, gw = blocked.shape
        self.gw, self.gh = gw, gh
        # A "you are here" dot is ink too. Clear a small disc so the mark
        # does not wall in its own point. An exit gets no disc: it is often on
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
        self.dist = [math.inf] * (gw * gh)
        self.next = [-1] * (gw * gh)
        self.owner = [-1] * (gw * gh)  # the exit each cell leads to

        if not self.exits:
            return
        heap: list[tuple[float, int]] = []
        for k, e in enumerate(self.exits):
            g = self.snap(e)
            if g is not None and self.owner[g] < 0:
                self.dist[g] = 0.0
                self.owner[g] = k
                heap.append((0.0, g))
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
