"""Where a tap starts a route (web/route.js Field.tapStart): a tap off the
floor drawing gives no route, a tap on a wall or on ink next to open floor
starts on that floor, a tap in a closed area next to floor with a way out
starts there, and a tap deep in a closed area gives no start."""

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from test_route_parity import NODE, payload

RUNNER = Path(__file__).parent / "tap_check.js"
SCALE = 0.25  # 4 pixels for each cell


def px(r, c):
    """The middle of grid cell (r, c) in pixels."""
    return [(c + 0.5) / SCALE, (r + 0.5) / SCALE]


def plan():
    """A building of 40 by 60 cells in a grid of 80 by 100. All of the grid
    outside the building is wall, as outside the floor box of the model.
    A one-cell wall at column 50 closes the right part: it has no exit.
    In the left part: a symbol of 5 by 5 cells and a filled block of 10 by 10."""
    blocked = np.ones((80, 100), bool)
    blocked[20:60, 20:80] = False
    blocked[20:60, 50] = True
    blocked[30:35, 30:35] = True
    blocked[42:52, 30:40] = True
    return {"grid": payload(blocked, SCALE), "exits": [px(40, 21)]}


TAPS = {
    "corridor": px(25, 45),
    "thin wall": px(40, 50),         # open floor one cell away on both sides; only the left has a way out
    "outer wall": px(40, 19),        # just outside the open box, on the wall of the building
    "symbol": px(32, 32),            # 3 cells from open floor, more than the tap reach
    "filled block": px(47, 35),      # 5 cells from open floor, and too big for a symbol
    "outside": px(40, 10),           # the margin of the sheet, off the floor drawing
    "far outside": px(5, 5),
    "closed room": px(40, 65),
    "closed room by the wall": px(40, 51),  # two cells from floor with a way out
}


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_tap_rules():
    case = {**plan(), "taps": list(TAPS.values())}
    out = json.loads(subprocess.run([NODE, str(RUNNER)], input=json.dumps(case), capture_output=True,
                                    text=True, check=True).stdout)
    got = dict(zip(TAPS, out["taps"]))
    assert out["box"] == [80, 80, 320, 240]
    assert got["corridor"] == {"at": "open", "cell": [25, 45], "way": True, "route": "route"}
    # A wall tap goes to the side with a way out, not to the closed room.
    assert got["thin wall"] == {"at": "moved", "cell": [40, 49], "way": True, "route": "route"}
    assert got["outer wall"] == {"at": "moved", "cell": [40, 20], "way": True, "route": "route"}
    assert got["symbol"]["at"] == "moved" and got["symbol"]["route"] == "route"
    assert got["filled block"] == {"at": "wall"}
    assert got["outside"] == {"at": "outside"}
    assert got["far outside"] == {"at": "outside"}
    # A closed area gives "noway" with its cell (the page asks for the exit of
    # a large one, and gives no start in a small one), unless floor with a way
    # out is in tap reach (ux review, 2026-11-02).
    assert got["closed room"] == {"at": "noway", "cell": [40, 65], "way": False, "route": "no open way to an exit"}
    assert got["closed room by the wall"] == {"at": "moved", "cell": [40, 49], "way": True, "route": "route"}


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_exit_mark_on_wall_is_refused():
    """A marked exit with no open floor in exit reach is refused (app.js
    setExit): the exits stay as they were (judge review, 2026-11-03: a mark
    on blank paper removed every exit). A mark in a doorway or next to the
    floor is kept."""
    marks = {"blank paper": px(40, 5), "far corner": px(5, 95), "in the filled block": px(47, 35),
             "on the outer wall": px(40, 19), "in the corridor": px(25, 45)}
    case = {**plan(), "taps": [], "marks": list(marks.values())}
    out = json.loads(subprocess.run([NODE, str(RUNNER)], input=json.dumps(case), capture_output=True,
                                    text=True, check=True).stdout)
    got = dict(zip(marks, out["marks"]))
    # A mark on ink a few cells from the floor snaps to it (route.js exitCells).
    assert got == {"blank paper": False, "far corner": False, "in the filled block": True,
                   "on the outer wall": True, "in the corridor": True}
