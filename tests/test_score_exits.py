"""scripts/score_exits.py on synthetic labels and runs (no photos, no model)."""

import importlib.util
import itertools
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("score_exits", Path(__file__).parent.parent / "scripts" / "score_exits.py")
se = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(se)


def lab(n, x, y, conf="sure"):
    return {"n": n, "x": x, "y": y, "confidence": conf, "reason": ""}


def photo(exits, box=(0, 0, 1000, 500), judgeable=True):
    return {"size": [1600, 1200], "plan_box": list(box), "judgeable": judgeable, "exits": exits}


def item(pid, points, route=True, error=None):
    reading = None if points is None else {"exits": [{"x": x, "y": y, "label": ""} for x, y in points]}
    return {"id": pid, "reading": reading, "route_found": route, "error": error}


def test_hungarian_is_optimal_on_small_matrices():
    cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]]
    cols = se.hungarian(cost)
    best = min(sum(cost[i][p[i]] for i in range(3)) for p in itertools.permutations(range(3)))
    assert sum(cost[i][c] for i, c in enumerate(cols)) == best
    assert sorted(cols) == [0, 1, 2]


def test_hungarian_rectangular():
    assert se.hungarian([[5, 1, 9]]) == [1]
    with pytest.raises(ValueError):
        se.hungarian([[1], [2]])


def test_radius_from_label_box_with_floor():
    assert se.radius_for(photo([], box=(0, 0, 1000, 400)), 0.05) == 50
    assert se.radius_for(photo([], box=(0, 0, 100, 50)), 0.05) == se.MIN_RADIUS_PX
    assert se.radius_for({"size": [1600, 900], "exits": []}, 0.05) == 80  # no box: image long side


def test_hits_misses_and_false_exits():
    p = photo([lab(1, 100, 100), lab(2, 900, 100)])
    s = se.score_photo(p, [(110, 95), (500, 300)], 0.05)  # R = 50
    assert (s["hits"], s["misses"], s["false_exits"], s["all_right"]) == (1, [2], [[500, 300]], False)


def test_one_prediction_cannot_take_two_labels():
    # Two doors 40 px apart; one point between them hits one door only.
    p = photo([lab(1, 100, 100), lab(2, 140, 100)])
    s = se.score_photo(p, [(120, 100)], 0.05)
    assert s["hits"] == 1 and len(s["misses"]) == 1


def test_optimal_match_beats_greedy():
    # Greedy by distance pairs pred A with label 2 (d=10) and leaves label 1 without a match;
    # the optimal match gives each label its own prediction.
    p = photo([lab(1, 100, 100), lab(2, 140, 100)])
    s = se.score_photo(p, [(130, 100), (185, 100)], 0.05)  # A is 30 from 1 and 10 from 2; B is 45 from 2
    assert s["hits"] == 2 and not s["false_exits"]


def test_unsure_label_is_optional():
    p = photo([lab(1, 100, 100), lab(2, 600, 300, "unsure")])
    on = se.score_photo(p, [(100, 100), (600, 300)], 0.05)
    off = se.score_photo(p, [(100, 100)], 0.05)
    assert on["all_right"] and off["all_right"]
    assert on["on_unsure"] == 1 and not on["false_exits"]
    strict = se.score_photo(p, [(100, 100)], 0.05, strict=True)
    assert strict["misses"] == [2] and not strict["all_right"]


def test_sure_label_wins_over_unsure_neighbour():
    p = photo([lab(1, 100, 100, "unsure"), lab(2, 130, 100)])
    s = se.score_photo(p, [(110, 100)], 0.05)  # closer to the unsure label, but in reach of the sure one
    assert s["hits"] == 1 and s["misses"] == []


def test_score_run_totals_and_routes():
    labels = {"photos": {
        "a": photo([lab(1, 100, 100), lab(2, 900, 100)]),
        "b": photo([lab(1, 500, 250)]),
        "c": photo([], judgeable=False),
        "d": photo([lab(1, 300, 300)]),
    }}
    items = {"a": item("a", [(100, 100), (900, 105)]),
             "b": item("b", [(500, 250), (50, 450)], route=False),
             "c": item("c", [(1, 1)]),
             "d": item("d", None, route=False, error="model API status 500")}
    r = se.score_run(items, labels, 0.05)
    assert (r["hits"], r["sure_labels"], r["false_exits"]) == (3, 4, 1)
    assert r["exit_precision"] == 0.75 and r["exit_recall"] == 0.75
    assert (r["photos_all_right"], r["photos_judged"]) == (1, 3)
    assert r["photos"]["c"] == {"judgeable": False}
    assert r["photos"]["d"]["error"] == "model API status 500"
    routes = se.route_share(items, labels)
    assert routes["all"] == {"photos": 4, "with_route": 2, "share": 0.5}
    assert routes["judgeable"]["with_route"] == 1


def test_model_points_need_read():
    it = item("a", [(1, 1)])
    with pytest.raises(SystemExit):
        se.predicted(it, "model")
    it["read"] = {"exits": [{"at": [10, 10]}, {"at": [20, 20], "zoom": "moved", "zoom_at": [25, 25]},
                            {"at": [30, 30], "zoom": "dropped"}]}
    assert se.predicted(it, "model") == [(10.0, 10.0), (25.0, 25.0)]


def test_main_writes_json_and_table(tmp_path, capsys):
    run = tmp_path / "run"
    (run / "items").mkdir(parents=True)
    (run / "items" / "a.json").write_text(json.dumps(item("a", [(100, 100)])))
    labels = tmp_path / "labels.json"
    labels.write_text(json.dumps({"photos": {"a": photo([lab(1, 102, 98)]), "b": photo([lab(1, 5, 5)])}}))
    assert se.main([str(run), str(labels)]) == 0
    out = json.loads((run / "score-final.json").read_text())
    assert set(out["at"]) == {"0.025", "0.05", "0.1"}
    assert out["at"]["0.05"]["photos"]["a"]["all_right"] is True
    assert out["not_run"] == ["b"]
    text = capsys.readouterr().out
    assert "precision" in text and "not in the run" in text


def test_other_plan_size_is_not_scored():
    labels = {"photos": {"a": photo([lab(1, 100, 100)])}}
    it = item("a", [(100, 100)])
    it["size"] = [1200, 900]
    r = se.score_run({"a": it}, labels, 0.05)
    assert r["photos"]["a"]["frame_mismatch"] == [[1200, 900], [1600, 1200]]
    assert r["photos_judged"] == 0
