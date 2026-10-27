"""Find the shortest way from "you are here" to the nearest exit.

The wall mask is shrunk to a coarse grid. A cell is blocked when enough of it
is wall. A* runs on the 8-connected grid. Cells close to a wall cost a little
more, so the route keeps to the middle of corridors and doors.
"""

from __future__ import annotations

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


@dataclass
class Route:
    points: list[tuple[float, float]]  # image pixels, start first
    exit_index: int                    # which exit the route reaches
    length_px: float


class NoRoute(Exception):
    pass


class Grid:
    def __init__(self, walls: np.ndarray):
        h, w = walls.shape
        self.scale = GRID_SIDE / max(h, w)
        gw, gh = max(1, round(w * self.scale)), max(1, round(h * self.scale))
        share = cv2.resize(walls.astype(np.float32), (gw, gh), interpolation=cv2.INTER_AREA)
        self.blocked = share >= BLOCK_SHARE
        free = (~self.blocked).astype(np.uint8)
        dist = cv2.distanceTransform(free, cv2.DIST_L2, 3)
        self.cost = 1.0 + WALL_COST / (1.0 + dist)
        self.free_cells = np.argwhere(~self.blocked)  # (row, col)

    def to_cell(self, xy: tuple[float, float]) -> tuple[int, int]:
        gh, gw = self.blocked.shape
        c = min(gw - 1, max(0, int(xy[0] * self.scale)))
        r = min(gh - 1, max(0, int(xy[1] * self.scale)))
        return r, c

    def to_px(self, cell: tuple[int, int]) -> tuple[float, float]:
        r, c = cell
        return ((c + 0.5) / self.scale, (r + 0.5) / self.scale)

    def snap(self, xy: tuple[float, float]) -> tuple[int, int] | None:
        """Move a point to the nearest free cell, or None when none is close."""
        r, c = self.to_cell(xy)
        if not self.blocked[r, c]:
            return r, c
        if len(self.free_cells) == 0:
            return None
        d2 = ((self.free_cells - (r, c)) ** 2).sum(axis=1)
        i = int(np.argmin(d2))
        if math.sqrt(d2[i]) > SNAP_SHARE * max(self.blocked.shape):
            return None
        return tuple(int(v) for v in self.free_cells[i])


def find_route(walls: np.ndarray, start: tuple[float, float],
               exits: list[tuple[float, float]]) -> Route:
    """Return the cheapest route from start to any exit, in image pixels."""
    if not exits:
        raise NoRoute("no exits")
    # A "you are here" dot or an exit sign is ink too. Clear a small disc so
    # the mark does not wall in its own point.
    walls = walls.copy()
    radius = max(2, round(MARK_CLEAR_SHARE * max(walls.shape)))
    disc = np.zeros(walls.shape, np.uint8)
    for x, y in [start, *exits]:
        cv2.circle(disc, (round(x), round(y)), radius, 1, -1)
    walls[disc.astype(bool)] = False
    grid = Grid(walls)
    s = grid.snap(start)
    if s is None:
        raise NoRoute("start is inside a wall")
    goals: dict[tuple[int, int], int] = {}
    for i, e in enumerate(exits):
        g = grid.snap(e)
        if g is not None:
            goals.setdefault(g, i)
    if not goals:
        raise NoRoute("every exit is inside a wall")

    goal_list = list(goals)

    def h(cell: tuple[int, int]) -> float:
        # Octile distance to the closest goal. The lowest cell cost is 1, so
        # this never overestimates.
        best = math.inf
        for gr, gc in goal_list:
            dr, dc = abs(cell[0] - gr), abs(cell[1] - gc)
            best = min(best, max(dr, dc) + (SQRT2 - 1) * min(dr, dc))
        return best

    blocked, cost = grid.blocked, grid.cost
    gh, gw = blocked.shape
    steps = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
             (-1, -1, SQRT2), (-1, 1, SQRT2), (1, -1, SQRT2), (1, 1, SQRT2)]
    best_g = {s: 0.0}
    came: dict[tuple[int, int], tuple[int, int]] = {}
    heap = [(h(s), 0.0, s)]
    while heap:
        _, g, cell = heapq.heappop(heap)
        if g > best_g.get(cell, math.inf):
            continue
        if cell in goals:
            path = [cell]
            while path[-1] in came:
                path.append(came[path[-1]])
            path.reverse()
            pts = [grid.to_px(p) for p in path]
            pts[0] = start
            pts[-1] = exits[goals[cell]]
            length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            return Route(points=pts, exit_index=goals[cell], length_px=length)
        r, c = cell
        for dr, dc, step in steps:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < gh and 0 <= nc < gw) or blocked[nr, nc]:
                continue
            # No corner cutting through the gap between two diagonal walls.
            if dr and dc and (blocked[r, nc] or blocked[nr, c]):
                continue
            ng = g + step * cost[nr, nc]
            if ng < best_g.get((nr, nc), math.inf):
                best_g[(nr, nc)] = ng
                came[(nr, nc)] = cell
                heapq.heappush(heap, (ng + h((nr, nc)), ng, (nr, nc)))
    raise NoRoute("no open way to an exit")
