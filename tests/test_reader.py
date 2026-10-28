import json

import httpx
import numpy as np
import pytest

from hereout.reader import ModelClient, ModelError, Prices, SpendCapReached, SpendLedger, parse_answer


def answer(content, usage=None):
    return {"choices": [{"message": {"content": content}}],
            "usage": usage or {"prompt_tokens": 3000, "completion_tokens": 1000}}


def make_client(tmp_path, handler, cap=1.0):
    ledger = SpendLedger(tmp_path / "spend.json", cap)
    return ModelClient("k", ledger, prices=Prices(1.25, 4.25),
                       transport=httpx.MockTransport(handler)), ledger


def test_parse_scales_to_pixels():
    r = parse_answer('ok {"you_are_here": [500, 250], "exits": [{"x": 1000, "y": 0, "label": "A"}],'
                     ' "plan_box": [100, 0, 900, 1000]}', 800, 400)
    assert r.you_are_here == (400, 100)
    assert r.exits == [{"x": 800, "y": 0, "label": "A"}]
    assert r.plan_box == (80, 0, 720, 400)


def test_parse_drops_bad_points():
    r = parse_answer('{"you_are_here": [1500, 2], "exits": [[10, 10], {"x": "a"}],'
                     ' "plan_box": [0, 0, 5, 5]}', 1000, 1000)
    assert r.you_are_here is None
    assert r.exits == [{"x": 10, "y": 10, "label": ""}]
    assert r.plan_box is None


def test_parse_clamps_a_small_miss():
    r = parse_answer('{"you_are_here": [1001, -3], "exits": [{"x": 1008, "y": 500}, {"x": 1020, "y": 500}]}', 1000, 1000)
    assert r.you_are_here == (1000, 0)
    assert r.exits == [{"x": 1000, "y": 500, "label": ""}]


def test_parse_needs_json():
    with pytest.raises(ModelError):
        parse_answer("sorry", 10, 10)


def test_read_plan_records_cost(tmp_path):
    seen = []

    def handler(request):
        seen.append((json.loads(request.content), request.headers["user-agent"]))
        if len(seen) == 1:
            return httpx.Response(200, json=answer('{"you_are_here": [100, 100], "exits": []}'))
        return httpx.Response(200, json=answer('{"you_are_here": [500, 500]}'))

    client, ledger = make_client(tmp_path, handler)
    reading = client.read_plan(np.zeros((200, 300, 3), np.uint8))
    # First guess (30, 20); the zoomed crop is 105 px wide at the image corner.
    assert reading.you_are_here == (52.5, 52.5)
    one_call = (3000 * 1.25 + 1000 * 4.25) / 1e6
    assert reading.cost_usd == pytest.approx(2 * one_call)
    snap = ledger.snapshot()
    assert snap["calls"] == 2 and snap["reserved_usd"] == 0
    assert snap["spent_usd"] == pytest.approx(reading.cost_usd)
    for body, ua in seen:
        assert body["model"].startswith("meta-models/")
        assert body["reasoning_effort"] == "low"
        assert "@" not in ua


def test_refine_null_keeps_first_guess(tmp_path):
    answers = iter(['{"you_are_here": [100, 100], "exits": []}', '{"you_are_here": null}'])

    def handler(request):
        return httpx.Response(200, json=answer(next(answers)))

    client, _ = make_client(tmp_path, handler)
    assert client.read_plan(np.zeros((200, 300, 3), np.uint8)).you_are_here == (30, 20)


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
