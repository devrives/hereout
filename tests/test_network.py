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
