"""web/route.js must find the same field, routes and steps as the Python code."""

import base64
import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from hereout.route import Field, NoRoute, grid_payload
from hereout.steps import directions
from hereout.walls import wall_mask

from conftest import draw_plan

NODE = shutil.which("node")
RUNNER = Path(__file__).parent / "route_parity.js"


def payload(blocked, scale):
    bits = np.packbits(blocked.ravel().astype(np.uint8))
    gh, gw = blocked.shape
    return {"w": gw, "h": gh, "scale": scale, "bits": base64.b64encode(bits.tobytes()).decode()}


def cases():
    img, here, exit_ = draw_plan()
    out = [{"grid": grid_payload(wall_mask(img)), "exits": [list(exit_), [40, 380]], "clear": [list(here)],
            "starts": [list(here), [600, 300], [400, 40], [5, 5]], "width": 800, "height": 500}]
    rng = np.random.default_rng(7)
    for _ in range(6):
        gh, gw = int(rng.integers(20, 70)), int(rng.integers(20, 70))
        blocked = rng.random((gh, gw)) < rng.uniform(0.1, 0.4)
        scale = 0.25
        w, h = gw / scale, gh / scale
        pts = lambda n: [[float(rng.uniform(0, w)), float(rng.uniform(0, h))] for _ in range(n)]
        out.append({"grid": payload(blocked, scale), "exits": pts(int(rng.integers(1, 5))), "clear": pts(1),
                    "starts": pts(12), "width": w, "height": h})
    return out


def python_answer(c):
    g = c["grid"]
    bits = np.unpackbits(np.frombuffer(base64.b64decode(g["bits"]), np.uint8))
    blocked = bits[: g["w"] * g["h"]].reshape(g["h"], g["w"]).astype(bool)
    f = Field(blocked, g["scale"], [tuple(e) for e in c["exits"]], clear=[tuple(p) for p in c["clear"]])
    routes = []
    for s in c["starts"]:
        try:
            r = f.route(tuple(s))
        except NoRoute as e:
            routes.append({"error": str(e)})
            continue
        routes.append({"points": r.points, "exit_index": r.exit_index,
                       "steps": [x["text"] for x in directions(r.points, c["width"], c["height"])]})
    return {"dist": f.dist, "owner": f.owner, "routes": routes}


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_matches_python():
    cs = cases()
    js = json.loads(subprocess.run([NODE, str(RUNNER)], input=json.dumps(cs), capture_output=True,
                                   text=True, check=True).stdout)
    n_routes = 0
    for c, a in zip(cs, js):
        p = python_answer(c)
        assert a["owner"] == p["owner"]
        for x, y in zip(a["dist"], p["dist"]):
            assert (x is None and math.isinf(y)) or x == y
        for ra, rp in zip(a["routes"], p["routes"]):
            assert ra.get("error") == rp.get("error")
            if "error" in rp:
                continue
            n_routes += 1
            assert ra["exit_index"] == rp["exit_index"]
            assert ra["steps"] == rp["steps"]
            assert np.allclose(ra["points"], rp["points"])
    assert n_routes >= 20  # the cases must reach exits, or the test proves little
