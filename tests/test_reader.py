import json

import httpx
import numpy as np
import pytest

from hereout.reader import (ModelClient, ModelError, Prices, SpendCapReached, SpendLedger, parse_answer,
                            suspect_exits)


def answer(content, usage=None):
    return {"choices": [{"message": {"content": content}}],
            "usage": usage or {"prompt_tokens": 3000, "completion_tokens": 1000}}


def make_client(tmp_path, handler, cap=1.0):
    ledger = SpendLedger(tmp_path / "spend.json", cap)
    return ModelClient("k", ledger, prices=Prices(1.25, 4.25),
                       transport=httpx.MockTransport(handler)), ledger


def test_parse_scales_to_pixels():
    r = parse_answer('ok {"final_exits": [{"x": 1000, "y": 0, "label": "A"}],'
                     ' "floor_drawing": {"x_min": 100, "y_min": 0, "x_max": 900, "y_max": 1000}}', 800, 400)
    assert r.exits == [{"x": 800, "y": 0, "label": "A"}]
    assert r.plan_box == (80, 0, 720, 400)


def test_parse_drops_bad_points():
    r = parse_answer('{"final_exits": [{"x": 10, "y": 10}, {"x": "a"}, [5, 5], {"x": 1500, "y": 2}],'
                     ' "floor_drawing": {"x_min": 0, "y_min": 0, "x_max": 5, "y_max": 5}}', 1000, 1000)
    assert r.exits == [{"x": 10, "y": 10, "label": ""}]
    assert r.plan_box is None


def test_parse_clamps_a_small_miss():
    r = parse_answer('{"final_exits": [{"x": 1008, "y": -3}, {"x": 1020, "y": 500}]}', 1000, 1000)
    assert r.exits == [{"x": 1000, "y": 0, "label": ""}]


def test_parse_needs_json():
    with pytest.raises(ModelError):
        parse_answer("sorry", 10, 10)


def test_read_plan_records_cost(tmp_path):
    seen = []

    def handler(request):
        seen.append((json.loads(request.content), request.headers["user-agent"]))
        return httpx.Response(200, json=answer('{"final_exits": [{"x": 100, "y": 100}]}'))

    client, ledger = make_client(tmp_path, handler)
    # A suspect exit gets a second look: two calls.
    reading = client.read_plan(np.zeros((200, 300, 3), np.uint8))
    assert [(e["x"], e["y"]) for e in reading.exits] == [(30, 20)]
    one_call = (3000 * 1.25 + 1000 * 4.25) / 1e6
    assert reading.cost_usd == pytest.approx(2 * one_call)
    snap = ledger.snapshot()
    assert snap["calls"] == 2 and snap["reserved_usd"] == 0
    assert snap["spent_usd"] == pytest.approx(reading.cost_usd)
    for body, ua in seen:
        assert body["model"].startswith("meta-models/")
        assert body["reasoning_effort"] == "low"
        assert "@" not in ua


def test_cap_blocks_before_the_call(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, json=answer("{}"))

    client, _ = make_client(tmp_path, handler, cap=0.01)
    with pytest.raises(SpendCapReached):
        client.read_plan(np.zeros((50, 50, 3), np.uint8))
    assert calls == []


def test_timeout_counts_worst_case(tmp_path):
    def handler(request):
        raise httpx.ReadTimeout("slow")

    client, ledger = make_client(tmp_path, handler)
    with pytest.raises(ModelError):
        client.read_plan(np.zeros((50, 50, 3), np.uint8))
    assert ledger.snapshot()["spent_usd"] > 0


def test_contributor_model_refused(tmp_path):
    with pytest.raises(ValueError):
        ModelClient("k", SpendLedger(tmp_path / "s.json", 1), model="meta-models/x-contributor")


def plan_with_sign():
    """A white plan, 400 x 300, with one green exit sign at (100, 100)."""
    img = np.full((300, 400, 3), 245, np.uint8)
    img[92:108, 88:112] = (40, 140, 40)
    return img


def test_suspects_are_far_from_route_colour():
    exits = [{"x": 100, "y": 100}, {"x": 300, "y": 200}, {"x": 104, "y": 98}, {"x": 300, "y": 60}]
    assert sorted(suspect_exits(plan_with_sign(), exits)) == [1, 3]
    assert suspect_exits(plan_with_sign(), []) == []


def test_zoom_moves_and_drops_suspect_exits(tmp_path):
    first = '{"final_exits": [{"x": 250, "y": 333}, {"x": 750, "y": 667}, {"x": 750, "y": 200}]}'
    # Exit 2 (300, 200) is suspect 1: crop x0 220, y0 120, 160 px, sent at 448 px on a 968 x 496 sheet.
    # Sheet point (314, 500) is crop point (100, 80): image point (320, 200), a move of 20 px.
    zoom = '{"exits": [{"n": 1, "sheet": 2, "x": 314, "y": 500}, {"n": 2, "sheet": 2, "point": null}]}'
    asked = []

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        images = len(content) - 1
        asked.append(images)
        return httpx.Response(200, json=answer(zoom if images > 1 else first))

    client, ledger = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert asked == [1, 2]
    assert [(round(e["x"]), round(e["y"])) for e in reading.exits] == [(100, 100), (320, 200)]
    assert ledger.snapshot()["calls"] == 2


def test_zoom_ignores_a_large_move(tmp_path):
    first = '{"final_exits": [{"x": 750, "y": 667}]}'
    zoom = '{"exits": [{"n": 1, "sheet": 2, "x": 900, "y": 900}]}'

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        return httpx.Response(200, json=answer(zoom if len(content) > 2 else first))

    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert [(round(e["x"]), round(e["y"])) for e in reading.exits] == [(300, 200)]

