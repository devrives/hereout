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
    assert all(a["waits"] and a["adopted"] and a["treesAdopted"] for a in out)
    # The lines to all exits make one network: each test plan is one open floor.
    assert all(a["pieces"] == 1 for a in out), [a["pieces"] for a in out]
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
    assert out["wing"] and out["adopted"] and out["treesAdopted"]

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


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_drawn_lines_lose_jogs_gaps_and_ticks():
    out = json.loads(subprocess.run([NODE, str(Path(__file__).parent / "schematize_check.js")], capture_output=True,
                                    text=True, check=True).stdout)
    # The jog: every level line is on one row, and the upright lines are one straight line.
    rows = {round(p[1], 3) for l in out["jog"] for p in (l["a"], l["b"]) if abs(l["a"][1] - l["b"][1]) < 1e-6}
    assert len(rows) == 1, out["jog"]
    assert all(abs(l["a"][0] - 50.5) < 1e-6 and abs(l["b"][0] - 50.5) < 1e-6 for l in out["jog"]
               if abs(l["a"][0] - l["b"][0]) < 1e-6)
    # The gap: the upright line now ends on the level line.
    assert any(abs(l["a"][0] - 40.5) < 1e-6 and abs(l["b"][0] - 40.5) < 1e-6 and min(l["a"][1], l["b"][1]) == 30.5
               for l in out["gap"]), out["gap"]
    # The tick: two cells to the side at the end of a line goes.
    assert all(abs(l["a"][1] - l["b"][1]) > 1e-6 or l["a"][1] < 60 for l in out["tick"]), out["tick"]
    # Both sides: the level lines meet on one row between the two.
    rows = {round(p[1], 3) for l in out["both"] for p in (l["a"], l["b"]) if abs(l["a"][1] - l["b"][1]) < 1e-6}
    assert len(rows) == 1 and 40.5 < rows.pop() < 44.5, out["both"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_exits_with_doors_side_by_side_join_the_lines():
    """A hall with two exit marks side by side on its left wall and one on the
    right. The growths from the two left doors touch at once. Both marks get a
    line, and all lines are one piece."""
    import math
    import numpy as np
    from hereout.route import grid_payload
    walls = np.ones((800, 1600), bool)
    walls[100:700, 100:1500] = False                    # the hall
    walls[100:700, 700:720] = True                      # a wall across it
    walls[380:420, 700:720] = False                     # its door
    case = {"grid": grid_payload(walls), "exits": [[105, 380], [105, 420], [1495, 400]]}
    js = r"""
const R = require(process.argv[1]);
let input = ""; process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const c = JSON.parse(input), g = c.grid;
  const f = new R.Field(R.decodeGrid(g), g.w, g.h, g.scale, c.exits, [], null, g.axes);
  process.stdout.write(JSON.stringify(f.network().legs.map((l) => [l.a, l.b])));
});"""
    legs = json.loads(subprocess.run([NODE, "-e", js, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
                                     input=json.dumps(case), capture_output=True, text=True, check=True).stdout)
    ends = [p for l in legs for p in l]
    assert all(any(math.dist(e, p) < 1 for p in ends) for e in case["exits"]), legs

    def gap(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)))
        return math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
    piece = list(range(len(legs)))

    def top(k):
        while piece[k] != k:
            k = piece[k]
        return k
    for i, (a, b) in enumerate(legs):
        for j, (c, d) in enumerate(legs[:i]):
            if min(gap(a, c, d), gap(b, c, d), gap(c, a, b), gap(d, a, b)) < 1:
                piece[top(i)] = top(j)
    assert len({top(k) for k in range(len(legs))}) == 1, legs
