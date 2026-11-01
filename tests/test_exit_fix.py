"""The y fix of the main call's exits (exit_fix.py), on synthetic points."""

import json

import httpx
import numpy as np
import pytest

from hereout.exit_fix import Y_PIVOT, Y_PULL, fix_exits, grid_y
from hereout.reader import ModelClient, Prices, SpendLedger


def test_grid_y_pulls_only_low_points_up():
    assert grid_y(Y_PIVOT) == Y_PIVOT
    assert grid_y(0) == 0 and grid_y(Y_PIVOT / 2) == Y_PIVOT / 2  # the upper part does not move
    assert grid_y(1000) == pytest.approx(1000 - Y_PULL * (1000 - Y_PIVOT))  # 950 with the shipped values
    assert grid_y(1000) < 1000
    # The order of points does not change, and every value stays on the grid.
    ys = [grid_y(v) for v in range(0, 1001, 50)]
    assert ys == sorted(ys) and 0 <= min(ys) and max(ys) <= 1000


def test_fix_exits_changes_only_y_in_pixels():
    exits = [{"x": 10.0, "y": 600.0, "label": "A"}, {"x": 20.0, "y": 300.0, "label": "B"}]
    out = fix_exits(exits, 600)
    assert [(e["x"], e["label"]) for e in out] == [(10.0, "A"), (20.0, "B")]
    assert out[0]["y"] == pytest.approx(grid_y(1000) / 1000 * 600)
    assert out[1]["y"] == pytest.approx(300.0)  # at the pivot (500 of 1000)
    assert exits[0]["y"] == 600.0  # the input is not changed


def test_read_plan_fixes_main_exits_but_not_the_box(tmp_path):
    first = ('{"final_exits": [{"x": 500, "y": 900}], '
             '"floor_drawing": {"x_min": 0, "y_min": 100, "x_max": 1000, "y_max": 900}}')

    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": first}}],
                                         "usage": {"prompt_tokens": 10, "completion_tokens": 10}})

    client = ModelClient("k", SpendLedger(tmp_path / "s.json", 1.0), prices=Prices(1.25, 4.25),
                         transport=httpx.MockTransport(handler))
    reading = client.read_plan(np.full((500, 400, 3), 245, np.uint8), refine=False)
    assert reading.exits[0]["x"] == pytest.approx(200)
    assert reading.exits[0]["y"] == pytest.approx(grid_y(900) / 2)
    assert reading.plan_box == pytest.approx((0, 50, 400, 450))
    assert json.loads(json.dumps(reading.trace))[0]["y"] == pytest.approx(reading.exits[0]["y"])
