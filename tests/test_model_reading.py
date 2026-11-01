"""The block "read" of an answer: what the model gave and what came of it."""

import numpy as np

from hereout.pipeline import Plan, answer, model_reading
from hereout.reader import Reading


def test_saved_reading_has_no_zoom_record():
    r = Reading([{"x": 10.4, "y": 20.6, "label": "ВЫХОД"}], plan_box=(1.2, 2, 300, 400))
    out = model_reading(r)
    assert out == {"box": [1, 2, 300, 400], "zoom": None,
                   "exits": [{"label": "ВЫХОД", "at": [10, 21], "exit": 0}], "sheets": []}


def test_zoom_and_code_results_line_up_with_the_exits():
    r = Reading(plan_box=None, zoom="done")
    r.trace = [
        {"x": 10, "y": 10, "label": "A"},                                         # not checked, used
        {"x": 50, "y": 50, "label": "B", "zoom": "moved", "to": (60, 52)},        # moved, then moved by code
        {"x": 90, "y": 90, "label": "C", "zoom": "dropped"},                      # dropped by the zoom check
        {"x": 120, "y": 20, "label": "D", "zoom": "unchanged"},                   # dropped by the code: legend
        {"x": 150, "y": 30, "label": "E"},                                        # dropped by the code: off the drawing
        {"x": 180, "y": 40, "label": "F"},                                        # used
    ]
    r.given = [{"x": 10, "y": 10}, {"x": 60, "y": 52}, {"x": 120, "y": 20}, {"x": 150, "y": 30}, {"x": 180, "y": 40}]
    r.code = [{"at": (10.3, 10)}, {"at": (60, 70)}, {"drop": "legend"}, {"drop": "off"}, {"at": (180, 40)}]
    rows = model_reading(r)["exits"]
    assert rows[0] == {"label": "A", "at": [10, 10], "exit": 0}
    assert rows[1] == {"label": "B", "at": [50, 50], "zoom": "moved", "zoom_at": [60, 52], "exit": 1, "placed_at": [60, 70]}
    assert rows[2] == {"label": "C", "at": [90, 90], "zoom": "dropped"}
    assert rows[3] == {"label": "D", "at": [120, 20], "zoom": "unchanged", "drop": "legend"}
    assert rows[4] == {"label": "E", "at": [150, 30], "drop": "off"}
    assert rows[5] == {"label": "F", "at": [180, 40], "exit": 2}


def test_answer_carries_the_reading_of_the_model():
    img = np.full((300, 400, 3), 255, np.uint8)
    img[40:260, 40:44] = img[40:260, 356:360] = img[40:44, 40:360] = img[256:260, 40:360] = 0
    reading = Reading([{"x": 200, "y": 150, "label": "Exit"}], plan_box=(30, 30, 370, 270))
    plan = Plan(img, np.zeros(img.shape[:2], bool), text=[])
    plan.use_reading(reading)
    out = answer(None, plan, reading, None)
    read = out["read"]
    assert read["box"] == [30, 30, 370, 270] and read["zoom"] is None
    used = [row for row in read["exits"] if "exit" in row]
    # Each used exit of the model is an exit of the answer, in the same order.
    assert [row["exit"] for row in used] == list(range(len(out["exits"])))
    for row in used:
        e = out["exits"][row["exit"]]
        assert [e["x"], e["y"]] == row.get("placed_at", row.get("zoom_at", row["at"]))


def test_no_reading_no_block():
    img = np.full((100, 100, 3), 255, np.uint8)
    plan = Plan(img, np.zeros(img.shape[:2], bool), text=[])
    plan.no_reading()
    assert "read" not in answer(None, plan, None, "model not configured")
