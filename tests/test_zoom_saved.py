"""scripts/zoom_saved.py: the zoom check on saved gallery readings, with a fake model."""

import json
import sys
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from conftest import draw_plan
from hereout.app import LONG_CACHE, create_app
from hereout.gallery import Gallery
from hereout.pipeline import Plan, answer
from hereout.reader import ModelClient, Prices, Reading, SpendLedger

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import zoom_saved  # noqa: E402

# draw_plan: 800 x 500, a green sign at (600..660, 80..120). Exit A is on the
# sign; B (at the exit gap) and C are far from it, so they are suspect. C is
# farther: crop 1. B is crop 2, crop box (640, 305) to (800, 465), at 2.8 times
# on a 968 x 496 sheet: sheet point (804, 248) is image point (750, 385).
EXITS = [{"x": 630, "y": 100, "label": "A"}, {"x": 770, "y": 385, "label": "B"}, {"x": 200, "y": 420, "label": "C"}]
ZOOM = '{"exits": [{"n": 1, "sheet": 2, "point": null}, {"n": 2, "sheet": 2, "x": 831, "y": 500}]}'


def make_gallery(tmp_path, exits=EXITS, pid="XX-test_000001"):
    img, _, _ = draw_plan()
    for sub in ("items", "plans", "thumbs"):
        (tmp_path / sub).mkdir(exist_ok=True)
    cv2.imwrite(str(tmp_path / "plans" / f"{pid}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(str(tmp_path / "thumbs" / f"{pid}.jpg"), img)
    item = {"id": pid, "country": "XX", "credit": {"title": "t", "author": "a", "licence": "CC0 1.0"},
            "size": [800, 500], "reading": {"exits": exits, "plan_box": [40, 40, 760, 460], "notes": ""},
            "route_found": True, "route_error": None, "open_with_way": 1.0, "text_boxes": []}
    (tmp_path / "items" / f"{pid}.json").write_text(json.dumps(item))
    return pid


def fake_client(tmp_path, reply=ZOOM, status=200):
    asked = []

    def handler(request):
        content = json.loads(request.content)["messages"][0]["content"]
        asked.append(len(content) - 1)  # images
        if status != 200:
            return httpx.Response(status)
        return httpx.Response(200, json={"choices": [{"message": {"content": reply}}],
                                         "usage": {"prompt_tokens": 4000, "completion_tokens": 800}})

    ledger = SpendLedger(tmp_path / "spend.json", 1.0)
    return ModelClient("k", ledger, prices=Prices(1.25, 4.25), transport=httpx.MockTransport(handler)), asked


def test_check_is_stored_in_the_item(tmp_path):
    pid = make_gallery(tmp_path)
    client, asked = fake_client(tmp_path)
    s = zoom_saved.zoom_one(tmp_path, pid, client)
    assert asked == [2]  # the plan and one sheet of two crops
    assert s["zoom"] == "done" and s["changed"]
    item = json.loads((tmp_path / "items" / f"{pid}.json").read_text())
    r = item["reading"]
    assert r["zoom"] == "done"
    assert [t["label"] for t in r["trace"]] == ["A", "B", "C"]
    assert "zoom" not in r["trace"][0]
    assert r["trace"][1]["zoom"] == "moved" and r["trace"][1]["crop"] == 2
    assert [round(v) for v in r["trace"][1]["to"]] == [750, 385]
    assert r["trace"][2] == {"x": 200, "y": 420, "label": "C", "zoom": "dropped", "crop": 1}
    assert [(e["label"], round(e["x"])) for e in r["exits"]] == [("A", 630), ("B", 750)]
    assert item["zoom_cost_usd"] == pytest.approx((4000 * 1.25 + 800 * 4.25) / 1e6, abs=1e-5)
    # The route result comes from the new exits.
    assert {"route_found", "route_error", "open_with_way"} <= item.keys()
    # The sheet that the model saw is in the gallery folder, as WebP.
    assert len(r["sheets"]) == 1 and r["sheets"][0].startswith(f"{pid}-1.")
    sheet = cv2.imread(str(tmp_path / "zoom" / r["sheets"][0]))
    assert sheet.shape[:2] == (496, 968)


def test_gallery_answer_shows_the_check_like_a_live_photo(tmp_path):
    pid = make_gallery(tmp_path)
    client, _ = fake_client(tmp_path)
    zoom_saved.zoom_one(tmp_path, pid, client)
    g = Gallery(tmp_path, order={})
    out = g.answer(pid)
    read = out["read"]
    assert read["zoom"] == "done"
    name = json.loads((tmp_path / "items" / f"{pid}.json").read_text())["reading"]["sheets"][0]
    assert read["sheets"] == [f"/gallery/zoom/{name}"]
    rows = read["exits"]
    assert [r.get("zoom") for r in rows] == [None, "moved", "dropped"]
    assert [r.get("crop") for r in rows] == [None, 2, 1]
    assert rows[1]["zoom_at"] == [750, 385]
    assert rows[1]["seen"] == pytest.approx([0.831, 0.5], abs=0.002)
    # The same record as for a live photo with the same main reading and answer.
    live_client, _ = fake_client(tmp_path)
    img = cv2.imread(str(tmp_path / "plans" / f"{pid}.jpg"))
    live = live_client.second_look(img, Reading(exits=[dict(e) for e in EXITS], plan_box=(40, 40, 760, 460)))
    plan = Plan(img, np.zeros(img.shape[:2], bool), text=[])
    plan.use_reading(live)
    live_read = answer(None, plan, live, None)["read"]
    assert live_read["exits"] == rows
    assert live_read["sheets"][0].startswith("data:image/webp;base64,")
    # Each used row is an exit of the answer, in order.
    used = [r for r in rows if "exit" in r]
    assert [r["exit"] for r in used] == list(range(len(out["exits"])))


def test_no_suspect_no_call(tmp_path):
    pid = make_gallery(tmp_path, exits=[{"x": 630, "y": 100, "label": "A"}])
    client, asked = fake_client(tmp_path)
    s = zoom_saved.zoom_one(tmp_path, pid, client)
    assert asked == [] and s["zoom"] == "none" and not s["changed"]
    r = json.loads((tmp_path / "items" / f"{pid}.json").read_text())["reading"]
    assert r["zoom"] == "none" and r["sheets"] == [] and r["trace"] == [{"x": 630, "y": 100, "label": "A"}]
    read = Gallery(tmp_path, order={}).answer(pid)["read"]
    assert read["zoom"] == "none" and read["sheets"] == []


def test_a_failed_call_saves_nothing(tmp_path):
    pid = make_gallery(tmp_path)
    before = (tmp_path / "items" / f"{pid}.json").read_text()
    client, _ = fake_client(tmp_path, status=400)
    assert zoom_saved.zoom_one(tmp_path, pid, client)["zoom"] == "failed"
    assert (tmp_path / "items" / f"{pid}.json").read_text() == before
    assert not list((tmp_path / "zoom").glob("*")) if (tmp_path / "zoom").exists() else True


def test_again_starts_from_the_main_reading(tmp_path):
    pid = make_gallery(tmp_path)
    client, _ = fake_client(tmp_path)
    zoom_saved.zoom_one(tmp_path, pid, client)
    first = json.loads((tmp_path / "items" / f"{pid}.json").read_text())["reading"]
    # A second run keeps all exits: the main reading comes from the trace, not the checked exits.
    client, asked = fake_client(tmp_path, reply='{"exits": []}')
    zoom_saved.zoom_one(tmp_path, pid, client)
    again = json.loads((tmp_path / "items" / f"{pid}.json").read_text())["reading"]
    assert asked == [2]
    assert [(t["x"], t["y"]) for t in again["trace"]] == [(t["x"], t["y"]) for t in first["trace"]]
    assert [t.get("why") for t in again["trace"]] == [None, "no answer", "no answer"]
    assert len(again["exits"]) == 3
    # The old sheet is gone; the new one has the same content, so the same name.
    assert sorted(p.name for p in (tmp_path / "zoom").glob("*.webp")) == again["sheets"]


def test_server_sends_sheets_with_a_long_cache(tmp_path):
    pid = make_gallery(tmp_path)
    client, _ = fake_client(tmp_path)
    zoom_saved.zoom_one(tmp_path, pid, client)
    name = json.loads((tmp_path / "items" / f"{pid}.json").read_text())["reading"]["sheets"][0]
    web = TestClient(create_app(use_env=False, gallery=Gallery(tmp_path, order={})))
    r = web.get(f"/gallery/zoom/{name}")
    assert r.status_code == 200 and r.headers["cache-control"] == LONG_CACHE
    assert r.headers["content-type"] == "image/webp"
    assert web.get("/gallery/zoom/nothing.webp").status_code == 404


def test_dry_run_makes_no_call(tmp_path, monkeypatch, capsys):
    make_gallery(tmp_path)
    monkeypatch.setattr(zoom_saved.ModelClient, "from_env", classmethod(lambda cls: pytest.fail("no client")))
    monkeypatch.setattr(sys, "argv", ["zoom_saved.py", str(tmp_path), "--dry-run"])
    assert zoom_saved.main() == 0
    assert "1 with a suspect exit (one call each), 2 suspect exits on 1 sheets" in capsys.readouterr().out
