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
