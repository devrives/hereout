"""scripts/far_points.py: refused far zoom points of saved gallery readings, used again with no call."""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

from test_zoom_saved import EXITS, fake_client, make_gallery

import hereout.reader as reader
from hereout.reader import Reading

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import far_points  # noqa: E402
import zoom_saved  # noqa: E402

# Crop 2 (exit B at (770, 385)) is the box (640, 305) to (800, 465), at 2.8
# times on a 968 x 496 sheet. Sheet point (657, 161) is image point (690, 325):
# 100 px from B, more than ZOOM_MAX_MOVE (56 px).
FAR = '{"exits": [{"n": 1, "sheet": 2, "point": null}, {"n": 2, "sheet": 2, "x": 657, "y": 161}]}'


def gallery_with_mark(tmp_path, mark: bool):
    """The test gallery; with mark, a green sign at the far point (690, 325)."""
    pid = make_gallery(tmp_path)
    path = tmp_path / "plans" / f"{pid}.jpg"
    img = cv2.imread(str(path))
    if mark:
        img[315:336, 678:703] = (40, 140, 40)
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return pid, img


def saved_with_old_rule(tmp_path, monkeypatch, pid):
    """The check as zoom_saved.py saved it before far_point_ok: every far point refused."""
    with monkeypatch.context() as m:
        m.setattr(reader, "far_point_ok", lambda *a: False)
        client, _ = fake_client(tmp_path, reply=FAR)
        zoom_saved.zoom_one(tmp_path, pid, client)
    item = json.loads((tmp_path / "items" / f"{pid}.json").read_text())
    assert item["reading"]["trace"][1]["why"] == "too far"
    return item


def test_a_far_point_on_a_mark_is_used_as_the_live_path_would(tmp_path, monkeypatch):
    pid, img = gallery_with_mark(tmp_path, mark=True)
    item = saved_with_old_rule(tmp_path, monkeypatch, pid)
    s = far_points.far_one(tmp_path, item, write=True)
    assert s["moved"] == [{"crop": 2, "from": [770, 385], "to": [690, 325]}]
    saved = json.loads((tmp_path / "items" / f"{pid}.json").read_text())["reading"]
    # The same exits and trace as the live path with the same answer.
    client, _ = fake_client(tmp_path, reply=FAR)
    live = client.second_look(img, Reading(exits=[dict(e) for e in EXITS], plan_box=(40, 40, 760, 460)))
    assert live.trace[1]["zoom"] == "moved" and live.trace[1]["far"] is True
    assert [(round(e["x"]), round(e["y"])) for e in saved["exits"]] == [(round(e["x"]), round(e["y"])) for e in live.exits]
    assert [t.get("zoom") for t in saved["trace"]] == [t.get("zoom") for t in live.trace]
    assert np.allclose(saved["trace"][1]["to"], live.trace[1]["to"], atol=0.1)
    assert "why" not in saved["trace"][1] and saved["trace"][1]["seen"] == item["reading"]["trace"][1]["seen"]
    # A second run changes nothing.
    again = json.loads((tmp_path / "items" / f"{pid}.json").read_text())
    assert far_points.far_one(tmp_path, again, write=True) is None


def test_a_far_point_on_blank_paper_stays_refused(tmp_path, monkeypatch):
    pid, _ = gallery_with_mark(tmp_path, mark=False)
    item = saved_with_old_rule(tmp_path, monkeypatch, pid)
    before = (tmp_path / "items" / f"{pid}.json").read_text()
    assert far_points.far_one(tmp_path, item, write=True) is None
    assert (tmp_path / "items" / f"{pid}.json").read_text() == before


def test_saved_exits_that_do_not_follow_from_the_trace_are_left(tmp_path, monkeypatch):
    pid, _ = gallery_with_mark(tmp_path, mark=True)
    item = saved_with_old_rule(tmp_path, monkeypatch, pid)
    item["reading"]["exits"][0]["x"] += 30
    assert far_points.far_one(tmp_path, item, write=False) is None


def test_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    pid, _ = gallery_with_mark(tmp_path, mark=True)
    saved_with_old_rule(tmp_path, monkeypatch, pid)
    before = (tmp_path / "items" / f"{pid}.json").read_text()
    monkeypatch.setattr(sys, "argv", ["far_points.py", str(tmp_path), "--dry-run"])
    assert far_points.main() == 0
    assert "would change: 1 points on 1 plans" in capsys.readouterr().out
    assert (tmp_path / "items" / f"{pid}.json").read_text() == before
