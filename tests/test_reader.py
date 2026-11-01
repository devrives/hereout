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
    # A timeout gets one more try; each try counts the worst case.
    assert ledger.snapshot()["calls"] == 2 and ledger.snapshot()["spent_usd"] > 0


def test_main_call_tried_again_after_a_timeout(tmp_path):
    asked = []

    def handler(request):
        asked.append(1)
        if len(asked) == 1:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, json=answer('{"final_exits": [{"x": 500, "y": 500}]}'))

    client, _ = make_client(tmp_path, handler)
    assert len(client.read_plan(np.zeros((50, 50, 3), np.uint8), refine=False).exits) == 1
    assert len(asked) == 2


def test_bad_request_is_not_tried_again(tmp_path):
    asked = []

    def handler(request):
        asked.append(1)
        return httpx.Response(400)

    client, _ = make_client(tmp_path, handler)
    with pytest.raises(ModelError):
        client.read_plan(np.zeros((50, 50, 3), np.uint8))
    assert len(asked) == 1


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
    # The page shows what the check did with each exit of the main call.
    assert reading.zoom == "done"
    assert [t.get("zoom") for t in reading.trace] == [None, "moved", "dropped"]
    assert [round(v) for v in reading.trace[1]["to"]] == [320, 200]
    assert (round(reading.trace[1]["x"]), round(reading.trace[1]["y"])) == (300, 200)
    # Each checked exit has the number of its crop; the page shows the sheets that the call sent.
    assert [t.get("crop") for t in reading.trace] == [None, 1, 2]
    # Where the model pointed, as a share of the sheet: the page draws it on the sheet.
    assert reading.trace[1]["seen"] == pytest.approx((0.314, 0.5), abs=0.002)
    assert "seen" not in reading.trace[2]
    assert len(reading.sheets) == 1 and reading.sheets[0].shape[:2] == (496, 968)


def test_no_zoom_after_a_slow_main_call(tmp_path, monkeypatch):
    import hereout.reader as reader
    first = '{"final_exits": [{"x": 750, "y": 667}]}'  # a suspect exit
    asked = []

    def handler(request):
        asked.append(1)
        return httpx.Response(200, json=answer(first))

    clock = iter([0.0, reader.ZOOM_SKIP_AFTER + 1])
    monkeypatch.setattr(reader.time, "monotonic", lambda: next(clock))
    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert len(asked) == 1 and len(reading.exits) == 1
    assert reading.zoom == "skipped" and "zoom" not in reading.trace[0]


def test_no_zoom_after_a_main_call_that_was_tried_again(tmp_path, monkeypatch):
    import hereout.reader as reader
    first = '{"final_exits": [{"x": 750, "y": 667}]}'  # a suspect exit
    asked = []

    def handler(request):
        asked.append(1)
        if len(asked) == 1:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, json=answer(first))

    # The first try waits for its timeout; the second try is fast. The wait
    # counts from the first try.
    clock = iter([0.0, reader.CALL_TIMEOUT + 5])
    monkeypatch.setattr(reader.time, "monotonic", lambda: next(clock))
    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert len(asked) == 2 and len(reading.exits) == 1


def test_call_timeouts_are_short():
    import hereout.reader as reader
    # Calls with an answer take 4 to 30 s; a call that stops answering must not
    # hold the user for minutes (wiki/decisions/call-timeouts.md).
    assert reader.CALL_TIMEOUT <= 45 and reader.ZOOM_TIMEOUT <= 25
    assert reader.ZOOM_SKIP_AFTER < reader.CALL_TIMEOUT


def test_zoom_ignores_a_large_move(tmp_path):
    first = '{"final_exits": [{"x": 750, "y": 667}]}'
    zoom = '{"exits": [{"n": 1, "sheet": 2, "x": 900, "y": 900}]}'

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        return httpx.Response(200, json=answer(zoom if len(content) > 2 else first))

    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert [(round(e["x"]), round(e["y"])) for e in reading.exits] == [(300, 200)]
    assert reading.trace[0]["zoom"] == "unchanged" and reading.trace[0]["why"] == "too far"
    assert reading.trace[0]["seen"] == pytest.approx((0.9, 0.9), abs=0.002)


def test_zoom_keeps_one_exit_when_it_drops_all(tmp_path):
    first = '{"final_exits": [{"x": 750, "y": 667}]}'
    zoom = '{"exits": [{"n": 1, "sheet": 2, "point": null}]}'

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        return httpx.Response(200, json=answer(zoom if len(content) > 2 else first))

    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert len(reading.exits) == 1 and reading.trace[0]["zoom"] == "unchanged"
    assert reading.trace[0]["why"] == "last exit"


def test_failed_zoom_keeps_the_points(tmp_path):
    first = '{"final_exits": [{"x": 750, "y": 667}]}'

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        if len(content) > 2:
            return httpx.Response(400)
        return httpx.Response(200, json=answer(first))

    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert reading.zoom == "failed" and len(reading.exits) == 1 and "zoom" not in reading.trace[0]
    assert reading.sheets == []


def test_no_suspect_no_zoom(tmp_path):
    first = '{"final_exits": [{"x": 250, "y": 333}]}'  # on the green sign
    asked = []

    def handler(request):
        asked.append(1)
        return httpx.Response(200, json=answer(first))

    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    assert len(asked) == 1 and reading.zoom == "none"



def test_zoom_without_an_entry_is_no_answer(tmp_path):
    first = '{"final_exits": [{"x": 750, "y": 667}]}'

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        return httpx.Response(200, json=answer('{"exits": []}' if len(content) > 2 else first))

    client, _ = make_client(tmp_path, handler)
    reading = client.read_plan(plan_with_sign())
    t = reading.trace[0]
    assert {k: t[k] for k in ("zoom", "why", "crop")} == {"zoom": "unchanged", "why": "no answer", "crop": 1}
    assert len(reading.exits) == 1
