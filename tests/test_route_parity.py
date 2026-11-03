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


def step_cases():
    """Routes whose steps split a turn back and fold a slanted staircase or a staircase of right angles."""
    rng = np.random.default_rng(11)
    out = [[(100, 50), (100, 300), (80, 300), (80, 200)],
           [(200, 100), (900, 100), (900, 146), (700, 146), (700, 170)],
           # A staircase of right angles on a diagonal (DE-commons_000022), an L with a jog, jogs on a way up.
           [(468, 912), (467.5, 877.5), (442.5, 877.5), (442.5, 862.5), (422.5, 862.5), (422.5, 842.5),
            (402.5, 842.5), (402.5, 817.5), (316, 817.5), (316, 827)],
           [(500, 300), (430, 300), (430, 330), (422, 330), (422, 400)],
           [(400, 600), (400, 575), (405, 575), (405, 550), (410, 550), (410, 525), (415, 525), (415, 500)]]
    for _ in range(40):
        p, pts = np.array([800.0, 450.0]), []
        for _ in range(int(rng.integers(6, 40))):
            pts.append(tuple(p))
            p = p + rng.choice([[20, 0], [-20, 0], [0, 20], [0, -20], [20, 20], [-20, 20], [20, -20], [-20, -20]]) \
                * rng.integers(1, 6)
        out.append([(float(x), float(y)) for x, y in pts])
    return out


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_steps_match_python():
    cs = step_cases()
    script = ("const R = require(process.argv[1]); let s = ''; process.stdin.on('data', (c) => { s += c; });"
              "process.stdin.on('end', () => process.stdout.write(JSON.stringify(JSON.parse(s).map("
              "(p) => R.directions(p, 1600, 900).map((x) => x.text)))));")
    js = json.loads(subprocess.run([NODE, "-e", script, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
                                   input=json.dumps(cs), capture_output=True, text=True, check=True).stdout)
    assert js == [[x["text"] for x in directions(c, 1600, 900)] for c in cs]
    # Without the staircase of right angles too (the count for the choice of route).
    script = script.replace("R.directions(p, 1600, 900)", "R.directions(p, 1600, 900, false)")
    js = json.loads(subprocess.run([NODE, "-e", script, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
                                   input=json.dumps(cs), capture_output=True, text=True, check=True).stdout)
    assert js == [[x["text"] for x in directions(c, 1600, 900, stairs=False)] for c in cs]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_steps_match_python_on_jogs():
    """Routes of level and upright legs with jogs and dips of many sizes
    (undip, detour, sideMove) give the same steps in both."""
    rng = np.random.default_rng(11)
    routes = []
    for _ in range(300):
        x, y = 600.0, 600.0
        pts = [(x, y)]
        across = bool(rng.integers(0, 2))
        for _ in range(int(rng.integers(2, 9))):
            d = float(rng.choice([1, -1])) * float(rng.uniform(10, 300))
            if across:
                x += d
            else:
                y += d
            across = not across if rng.random() < 0.8 else across
            pts.append((round(x, 1), round(y, 1)))
        routes.append({"points": pts, "width": 1200, "height": 1600})
    js = r"""
const R = require(process.argv[1]);
let input = ""; process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  const out = JSON.parse(input).map((c) => R.directions(c.points, c.width, c.height).map((s) => s.text));
  process.stdout.write(JSON.stringify(out));
});"""
    out = json.loads(subprocess.run([NODE, "-e", js, str(Path(__file__).parent.parent / "src/hereout/web/route.js")],
                                    input=json.dumps(routes), capture_output=True, text=True, check=True).stdout)
    for c, a in zip(routes, out):
        assert a == [s["text"] for s in directions(c["points"], c["width"], c["height"])], c["points"]
