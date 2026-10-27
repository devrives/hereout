import cv2
from fastapi.testclient import TestClient

from hereout.app import create_app
from hereout.reader import Reading

from conftest import draw_plan


class FakeReader:
    """Answers with fixed marks, in the image the server sends."""

    def __init__(self, here, exits):
        self.here, self.exits = here, exits

    def read_plan(self, img):
        return Reading(self.here, [{"x": x, "y": y, "label": ""} for x, y in self.exits])


def upload(client, img):
    ok, buf = cv2.imencode(".png", img)
    return client.post("/api/plan", files={"photo": ("p.png", buf.tobytes(), "image/png")})


def test_plan_with_marks_gets_a_route():
    img, here, exit_ = draw_plan()
    client = TestClient(create_app(FakeReader(here, [exit_]), use_env=False))
    r = upload(client, img)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] and data["steps"][-1]["kind"] == "arrive"
    assert data["image"].startswith("data:image/jpeg;base64,")


def test_no_model_then_two_taps():
    img, here, exit_ = draw_plan()
    client = TestClient(create_app(None, use_env=False))
    data = upload(client, img).json()
    assert data["route"] is None and data["model_error"] == "model not configured"
    r = client.post("/api/route", json={"id": data["id"], "here": here, "exits": [exit_]})
    assert r.status_code == 200 and r.json()["route"]


def test_bad_upload():
    client = TestClient(create_app(None, use_env=False))
    r = client.post("/api/plan", files={"photo": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400


def test_unknown_plan_id():
    client = TestClient(create_app(None, use_env=False))
    r = client.post("/api/route", json={"id": "nope", "here": [1, 1], "exits": [[2, 2]]})
    assert r.status_code == 404


def test_page_and_robots():
    client = TestClient(create_app(None, use_env=False))
    assert "HereOut" in client.get("/").text
    assert "Disallow: /" in client.get("/robots.txt").text
    assert client.head("/").status_code == 200


def make_gallery(tmp_path):
    import json
    from hereout.gallery import Gallery
    img, here, exit_ = draw_plan()
    for sub in ("plans", "thumbs", "items"):
        (tmp_path / sub).mkdir()
    cv2.imwrite(str(tmp_path / "plans" / "XX-test_1.jpg"), img)
    cv2.imwrite(str(tmp_path / "thumbs" / "XX-test_1.jpg"), img[:100, :100])
    item = {"id": "XX-test_1", "country": "XX", "route_found": True,
            "credit": {"title": "T", "author": "A", "licence": "CC0 1.0", "licence_url": "", "source_url": ""},
            "reading": {"you_are_here": here, "exits": [{"x": exit_[0], "y": exit_[1], "label": "E"}], "plan_box": None}}
    (tmp_path / "items" / "XX-test_1.json").write_text(json.dumps(item))
    # An item without a reading is left out.
    (tmp_path / "items" / "XX-bad.json").write_text(json.dumps({**item, "id": "XX-bad", "reading": None}))
    return Gallery(tmp_path)


def test_gallery_list_and_open(tmp_path):
    client = TestClient(create_app(None, use_env=False, gallery=make_gallery(tmp_path)))
    plans = client.get("/api/gallery").json()["plans"]
    assert [p["id"] for p in plans] == ["XX-test_1"]
    assert client.get(plans[0]["thumb"]).status_code == 200
    data = client.post("/api/gallery/XX-test_1").json()
    assert data["route"] and data["credit"]["author"] == "A"
    # The opened plan can be routed again with new marks.
    r = client.post("/api/route", json={"id": data["id"], "here": data["here"], "exits": [[data["exits"][0]["x"], data["exits"][0]["y"]]]})
    assert r.status_code == 200 and r.json()["route"]


def test_gallery_unknown_and_absent(tmp_path):
    client = TestClient(create_app(None, use_env=False, gallery=make_gallery(tmp_path)))
    assert client.post("/api/gallery/../../etc").status_code == 404
    assert client.post("/api/gallery/nope").status_code == 404
    empty = TestClient(create_app(None, use_env=False))
    assert empty.get("/api/gallery").json() == {"plans": []}


def test_gallery_mixes_countries(tmp_path):
    import json
    g = make_gallery(tmp_path)
    for i, c in enumerate(["AA", "AA", "AA", "BB", "CC"]):
        g.items[f"{c}-{i}"] = {**g.items["XX-test_1"], "id": f"{c}-{i}", "country": c}
    countries = [p["country"] for p in g.listing()[:4]]
    assert len(set(countries)) == 4
