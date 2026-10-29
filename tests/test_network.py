"""The way network of web/route.js: level and upright lines clear of ink, and routes along them."""

import json
import subprocess
from pathlib import Path

import pytest

from test_route_parity import NODE, cases

RUNNER = Path(__file__).parent / "network_check.js"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_network_lines_and_routes():
    cs = cases()
    out = json.loads(subprocess.run([NODE, str(RUNNER)], input=json.dumps(cs), capture_output=True,
                                    text=True, check=True).stdout)
    assert out[0]["legs"] > 0
    assert all(a["waits"] and a["adopted"] for a in out)
    n_routes = 0
    for c, a in zip(cs, out):
        assert a["legsClear"]
        assert a["straight"]
        for r in a["routes"]:
            # The network finds a route where the grid finds one, and only there.
            assert r.get("error") == r["gridError"]
            if "error" in r:
                continue
            n_routes += 1
            assert r["end"] == r["exit"]
            assert r["clear"]
            assert r["straight"]
    # The drawn plan: every start that has a way out reaches the network.
    assert all(r["onNetwork"] for r in out[0]["routes"] if "error" not in r)
    assert n_routes >= 20


def wing_plan():
    """A main block of rooms along x, and a wing of rooms turned 25 degrees
    that joins it at the left end. An exit at the far end of each."""
    import cv2
    import numpy as np
    floor = np.zeros((900, 1400), np.uint8)
    cv2.rectangle(floor, (500, 400), (1350, 700), 1, -1)
    wing = cv2.boxPoints(((330, 330), (240, 620), 25)).astype(np.int32)
    cv2.fillPoly(floor, [wing], 1)
    walls = cv2.morphologyEx(floor, cv2.MORPH_GRADIENT, np.ones((7, 7), np.uint8)) > 0
    rooms = np.zeros_like(floor)
    for x in range(600, 1350, 100):                    # rooms on both sides of the main corridor
        cv2.line(rooms, (x, 400), (x, 520), 1, 5)
        cv2.line(rooms, (x, 580), (x, 700), 1, 5)
    cv2.line(rooms, (500, 520), (1350, 520), 1, 5)
    cv2.line(rooms, (500, 580), (1350, 580), 1, 5)
    for x in range(560, 1350, 100):                    # doors to the corridor
        cv2.line(rooms, (x, 520), (x + 25, 520), 0, 7)
        cv2.line(rooms, (x, 580), (x + 25, 580), 0, 7)
    side = np.zeros_like(floor)
    for y in range(80, 560, 80):                       # the same in the wing, before the turn
        cv2.line(side, (210, y), (300, y), 1, 5)
        cv2.line(side, (360, y), (450, y), 1, 5)
    cv2.line(side, (300, 40), (300, 600), 1, 5)
    cv2.line(side, (360, 40), (360, 600), 1, 5)
    for y in range(110, 560, 80):
        cv2.line(side, (300, y), (300, y + 25), 0, 7)
        cv2.line(side, (360, y), (360, y + 25), 0, 7)
    turn = cv2.getRotationMatrix2D((330, 330), -25, 1.0)
    side = cv2.warpAffine(side, turn, (1400, 900), flags=cv2.INTER_NEAREST)
    walls |= ((rooms | side) > 0) & (floor > 0)
    walls |= floor == 0
    return walls


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_wing_lines_follow_the_wing():
    import math
    from hereout.route import grid_payload
    walls = wing_plan()
    case = {"grid": grid_payload(walls), "exits": [[1340, 550], [330 + 280 * math.sin(math.radians(25)), 330 - 280 * math.cos(math.radians(25))]]}
    out = json.loads(subprocess.run([NODE, str(Path(__file__).parent / "wing_check.js")], input=json.dumps(case),
                                    capture_output=True, text=True, check=True).stdout)
    assert out["wing"] and out["adopted"]

    def square_to(leg, tilt):
        a = math.degrees(math.atan2(leg["b"][1] - leg["a"][1], leg["b"][0] - leg["a"][0]))
        d = (a - math.degrees(tilt)) % 90
        return min(d, 90 - d) < 1.5

    inside = [l for l in out["legs"] if l["inWing"]]
    outside = [l for l in out["legs"] if l["outWing"]]
    assert inside and outside
    # The two parts: the lines of each follow its own walls.
    tilts = [out["axes"][0], out["wingAxes"][0]]
    assert {all(square_to(l, t) for l in inside) for t in tilts} == {True, False}
    assert {all(square_to(l, t) for l in outside) for t in tilts} == {True, False}


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_small_rooms_join_at_their_door():
    """A corridor with an exit at its end, small rooms on one side and a hall
    on the other. The map has no line inside a small room; the hall has one."""
    import cv2
    import numpy as np
    from hereout.route import grid_payload
    walls = np.ones((800, 1600), bool)
    walls[380:440, 100:1500] = False                     # the corridor
    for x in range(150, 1450, 130):                      # small rooms above it
        walls[250:370, x:x + 110] = False
        walls[365:385, x + 40:x + 70] = False            # the door
    walls[450:750, 300:1300] = False                     # the hall below it
    walls[435:455, 760:840] = False                      # its door
    walls |= cv2.morphologyEx(walls.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    case = {"grid": grid_payload(walls), "exits": [[1495, 410]]}
    out = json.loads(subprocess.run([NODE, str(Path(__file__).parent / "wing_check.js")], input=json.dumps(case),
                                    capture_output=True, text=True, check=True).stdout)
    ends = [p for l in out["legs"] for p in (l["a"], l["b"])]
    assert not any(255 < y < 360 for _, y in ends)       # no line inside a small room
    assert any(470 < y < 740 for _, y in ends)           # a line into the hall
    assert any(380 <= y <= 440 for _, y in ends)         # the corridor line


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_second_exit_is_another_door():
    """A corridor with an exit at each end and a second mark next to the left
    one. From a spot left of the middle the nearest exit is on the left; the
    second exit is the right one, not the mark beside the first."""
    import numpy as np
    from hereout.route import grid_payload
    walls = np.ones((400, 1600), bool)
    walls[150:250, 50:1550] = False
    case = {"grid": grid_payload(walls), "exits": [[60, 200], [75, 215], [1540, 200]], "start": [600, 200]}
    js = r"""
const R = require(process.argv[1]);
let input = ""; process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input), g = c.grid;
  const f = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes);
  const main = f.wayRoute(c.start).exitIndex;
  process.stdout.write(JSON.stringify({ main, other: f.otherExit(c.start, main), costs: f.exitCosts(c.start) }));
});"""
    out = json.loads(subprocess.run([NODE, "-e", js, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
                                    input=json.dumps(case), capture_output=True, text=True, check=True).stdout)
    assert out["main"] in (0, 1)
    assert out["other"] == 2
    assert all(c is not None and c < 1e9 for c in out["costs"])


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_second_exit_avoids_the_first_door():
    """A corridor with exits A (left end) and B (a side door next to A) and C
    (right end). From the middle-left the nearest exit is A. The second exit
    is not reached through the door of A: C, by the corridor to the right."""
    import numpy as np
    from hereout.route import grid_payload
    walls = np.ones((400, 1600), bool)
    walls[150:250, 50:1550] = False                     # the corridor
    walls[60:150, 40:100] = False                       # a passage up to B, from beside the door of A
    case = {"grid": grid_payload(walls), "exits": [[60, 165], [70, 60], [1540, 200]], "start": [500, 200]}
    js = r"""
const R = require(process.argv[1]);
let input = ""; process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input), g = c.grid;
  const f = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes);
  process.stdout.write(JSON.stringify({ near: f.nearestExit(c.start), others: f.otherExits(c.start, 0) }));
});"""
    out = json.loads(subprocess.run([NODE, "-e", js, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
                                    input=json.dumps(case), capture_output=True, text=True, check=True).stdout)
    assert out["near"] == 0
    assert out["others"][0] == 2


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_area_share_tells_a_floor_from_a_pocket():
    """Two floors on one sheet and a small pocket: a spot on the floor with no
    exit is in a large open area, a spot in the pocket in a small one."""
    import numpy as np
    from hereout.route import grid_payload
    walls = np.ones((800, 1600), bool)
    walls[100:350, 100:1500] = False    # the floor with the exit
    walls[450:700, 100:1300] = False    # the floor with no exit
    walls[450:500, 1400:1450] = False   # a pocket of paper
    case = {"grid": grid_payload(walls), "exits": [[110, 200]], "spots": [[700, 575], [1425, 475], [1580, 790]]}
    js = r"""
const R = require(process.argv[1]);
let input = ""; process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input), g = c.grid;
  const f = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes);
  process.stdout.write(JSON.stringify(c.spots.map((s) => f.areaShare(s))));
});"""
    floor, pocket, wall = json.loads(subprocess.run(
        [NODE, "-e", js, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
        input=json.dumps(case), capture_output=True, text=True, check=True).stdout)
    assert 0.3 < floor < 0.6
    assert 0 < pocket < 0.05
    assert wall == 0
