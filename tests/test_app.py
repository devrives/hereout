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
