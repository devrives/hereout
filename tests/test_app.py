import re
import time

import cv2
from fastapi.testclient import TestClient

from hereout.app import create_app
from hereout.reader import Reading
from hereout.route import NoRoute

from conftest import draw_plan, field_from_payload


class FakeReader:
    """Answers with fixed marks, in the image the server sends."""

    def __init__(self, exits):
        self.exits = exits

    def read_plan(self, img):
        return Reading([{"x": x, "y": y, "label": ""} for x, y in self.exits])


def upload(client, img):
    ok, buf = cv2.imencode(".png", img)
    return client.post("/api/plan", files={"photo": ("p.png", buf.tobytes(), "image/png")})


def read(client, img):
    """Upload a photo and ask for its answer until it is ready, as the page does."""
    r = upload(client, img)
    assert r.status_code == 202
    for _ in range(600):
        a = client.get(f"/api/plan/{r.json()['job']}")
        if a.status_code != 202:
            assert a.headers["cache-control"] == "no-store"
            return a
        time.sleep(0.05)
    raise AssertionError("no answer")


def test_plan_with_marks_gets_a_route():
    img, here, exit_ = draw_plan()
    client = TestClient(create_app(FakeReader([exit_]), use_env=False))
    r = read(client, img)
    assert r.status_code == 200
    data = r.json()
    assert data["image"].startswith("data:image/jpeg;base64,")
    # The model gives no start: the user taps it.
    assert data["id"] is None and "here" not in data
    # The grid the browser gets is enough to find the route.
    exits = [(e["x"], e["y"]) for e in data["exits"]]
    assert field_from_payload(data["grid"], exits).route(here).exit_index == 0


def test_no_model_still_sends_the_grid():
    img, here, exit_ = draw_plan()
    client = TestClient(create_app(None, use_env=False))
    data = read(client, img).json()
    assert data["exits"] == [] and data["model_error"] == "model not configured"
    # Marks the user places by hand are routed on the same grid.
    assert field_from_payload(data["grid"], [exit_]).route(here).exit_index == 0


def test_unknown_job():
    client = TestClient(create_app(None, use_env=False))
    assert client.get("/api/plan/nope").status_code == 404


def test_failed_job_gives_an_error():
    class Broken:
        def read_plan(self, img):
            raise RuntimeError("bug")

    img, _, _ = draw_plan()
    r = read(TestClient(create_app(Broken(), use_env=False)), img)
    assert r.status_code == 500 and "another photo" in r.json()["detail"]


def test_bad_upload():
    client = TestClient(create_app(None, use_env=False))
    r = client.post("/api/plan", files={"photo": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400


def test_sealed_start_has_no_route():
    img, here, exit_ = draw_plan()
    cv2.line(img, (400, 130), (400, 190), (20, 20, 20), 8)  # close the door
    client = TestClient(create_app(None, use_env=False))
    data = read(client, img).json()
    try:
        field_from_payload(data["grid"], [exit_]).route(here)
    except NoRoute as e:
        assert str(e) == "no open way to an exit"
        return
    raise AssertionError("expected NoRoute")


def test_page_and_robots():
    client = TestClient(create_app(None, use_env=False))
    page = client.get("/").text
    assert "HereOut" in page
    # Each static file carries a content hash, so an old cached copy is never used.
    assert re.search(r'src="/static/app\.js\?v=[0-9a-f]{10}"', page)
    assert 'href="/static/style.css?v=' in page
    assert "Disallow: /" in client.get("/robots.txt").text
    assert client.head("/").status_code == 200
    icon = client.get("/favicon.ico")
    assert icon.status_code == 200 and icon.content[:4] == b"\x00\x00\x01\x00"
    # A file with its content hash is kept for a year; without it, the usual time.
    assert "immutable" in client.get(re.search(r'/static/app\.js\?v=\w+', page)[0]).headers["cache-control"]
    assert "cache-control" not in client.get("/static/app.js").headers
    # An old hash gets the new file, but not for a year: a rollback must not find it.
    assert "cache-control" not in client.get("/static/app.js?v=0123456789").headers
    assert client.get("/static/fonts/geist-latin.woff2?v=0123456789").status_code == 200


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
            "reading": {"exits": [{"x": exit_[0], "y": exit_[1], "label": "E"}], "plan_box": None}}
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
    assert data["credit"]["author"] == "A" and data["grid"]["bits"]
    assert data["id"] == "g-XX-test_1"
    assert client.post("/api/route", json={}).status_code in (404, 405)


def test_saved_answer_is_sent(tmp_path):
    import json
    g = make_gallery(tmp_path)
    (tmp_path / "answers").mkdir()
    g.answer_path("XX-test_1").write_text(json.dumps({"id": "g-XX-test_1", "image": "data:image/jpeg;base64,", "saved": True}))
    assert TestClient(create_app(None, use_env=False, gallery=g)).post("/api/gallery/XX-test_1").json()["saved"]
    # A saved answer from other code is not used.
    g.code = "other"
    data = TestClient(create_app(None, use_env=False, gallery=g)).post("/api/gallery/XX-test_1").json()
    assert "saved" not in data and data["grid"]["bits"]


def test_saved_answer_with_its_image(tmp_path):
    import json
    g = make_gallery(tmp_path)
    (tmp_path / "answers").mkdir()
    out, image = g.answer_to_save("XX-test_1")
    path = g.answer_path("XX-test_1")
    path.write_text(json.dumps(out))
    client = TestClient(create_app(None, use_env=False, gallery=g))
    # Without its image the saved answer is not used: the server finds the answer again.
    assert client.post("/api/gallery/XX-test_1").json()["image"].startswith("data:image/jpeg")
    path.with_suffix(".webp").write_bytes(image)
    client = TestClient(create_app(None, use_env=False, gallery=g))  # the first one keeps the answer it found
    data = client.post("/api/gallery/XX-test_1").json()
    assert data["image"] == f"/gallery/answers/{path.stem}.webp" and data["grid"]["bits"]
    r = client.get(data["image"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp" and r.content[8:12] == b"WEBP"
    assert "immutable" in r.headers["cache-control"]
    # An answer with the image URL of another set is not sent.
    path.write_text(json.dumps({**out, "image": f"/review/gallery/answers/{path.stem}.webp"}))
    client = TestClient(create_app(None, use_env=False, gallery=g))
    assert client.post("/api/gallery/XX-test_1").json()["image"].startswith("data:image/jpeg")


def test_review_pages(tmp_path):
    gallery = make_gallery(tmp_path)
    assert TestClient(create_app(None, use_env=False, gallery=gallery, review=True)).get("/review/x/").status_code == 404
    (tmp_path / "review" / "x").mkdir(parents=True)
    (tmp_path / "review" / "x" / "index.html").write_text("<p>ok</p>")
    client = TestClient(create_app(None, use_env=False, gallery=gallery, review=True))
    assert client.get("/review/x/").text == "<p>ok</p>"


def make_review_set(tmp_path):
    main = make_gallery(tmp_path)
    (tmp_path / "review" / "gallery").mkdir(parents=True)
    make_gallery(tmp_path / "review" / "gallery")
    (tmp_path / "review" / "x").mkdir()
    (tmp_path / "review" / "x" / "index.html").write_text("<p>ok</p>")
    return main


def test_review_set(tmp_path):
    client = TestClient(create_app(None, use_env=False, gallery=make_review_set(tmp_path), review=True))
    plans = client.get("/api/gallery?set=review").json()["plans"]
    assert plans[0]["thumb"] == "/review/gallery/thumbs/XX-test_1.jpg"
    assert client.get(plans[0]["thumb"]).status_code == 200
    assert client.post("/api/gallery/XX-test_1?set=review").json()["id"] == "g-XX-test_1"
    assert client.get("/api/gallery").json()["plans"][0]["thumb"] == "/gallery/thumbs/XX-test_1.jpg"


def test_review_is_off_by_default(tmp_path, monkeypatch):
    """The test pages are not public: without HEREOUT_REVIEW=1 they give 404."""
    monkeypatch.delenv("HEREOUT_REVIEW", raising=False)
    client = TestClient(create_app(None, use_env=False, gallery=make_review_set(tmp_path)))
    assert client.get("/review/x/").status_code == 404
    assert client.get("/review/gallery/thumbs/XX-test_1.jpg").status_code == 404
    assert client.get("/api/gallery?set=review").status_code == 404
    assert client.post("/api/gallery/XX-test_1?set=review").status_code == 404
    # The public gallery stays.
    assert client.get("/api/gallery").json()["plans"][0]["id"] == "XX-test_1"
    assert client.post("/api/gallery/XX-test_1").json()["id"] == "g-XX-test_1"


def test_production_compose_sets_review_on_purpose():
    # /review/ is on only for the owner's sample run (wiki/decisions/sample-run.md):
    # the line names that decision, and it wins over an entry in .env.
    from pathlib import Path
    compose = (Path(__file__).parent.parent / "docker-compose.yml").read_text()
    line = next(l for l in compose.splitlines() if "HEREOUT_REVIEW:" in l)
    assert line.strip() in ('HEREOUT_REVIEW: "0"', 'HEREOUT_REVIEW: "1"')
    if line.strip().endswith('"1"'):
        assert "wiki/decisions/sample-run.md" in compose


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


def test_gallery_order_first_and_last(tmp_path):
    g = make_gallery(tmp_path)
    for i, c in enumerate(["AA", "AA", "BB", "CC", "DD"]):
        g.items[f"{c}-{i}"] = {**g.items["XX-test_1"], "id": f"{c}-{i}", "country": c}
    g.items["EE-5"] = {**g.items["XX-test_1"], "id": "EE-5", "country": "EE", "route_found": False}
    # Unknown ids and plans with no route are not put first.
    g.first, g.last = ["CC-3", "nope", "AA-1", "EE-5"], ["DD-4", "CC-3"]
    ids = [p["id"] for p in g.listing()]
    assert ids[:2] == ["CC-3", "AA-1"]
    assert ids[-2:] == ["DD-4", "EE-5"]
    assert sorted(ids) == sorted(g.items)


def test_gallery_order_file_names_real_plans():
    import json
    from hereout.gallery import ORDER_FILE
    order = json.loads(ORDER_FILE.read_text())
    assert len(order["first"]) >= 9 and len(set(order["first"])) == len(order["first"])
    assert not set(order["first"]) & set(order.get("last", []))


def example_template(pid):
    from hereout.app import EXAMPLE_CREDIT, EXAMPLE_PHOTO, EXAMPLE_TAG
    return (f'<p>a</p>\n{EXAMPLE_TAG} data-sample="{pid}" data-start="1,2">'
            f'<img src="{EXAMPLE_PHOTO}">{EXAMPLE_CREDIT}</figure>\n<p>b</p>')


def test_example_shows_the_saved_image(tmp_path):
    import json
    from hereout.app import example_page
    g = make_gallery(tmp_path)
    g.items["XX-test_1"]["credit"].update(title='The "A" plan', licence_url="https://l", source_url="https://s",
                                          changes=["resized"], share_alike=True)
    page = example_template("XX-test_1")
    # No saved image for the current code: the example goes, with its image.
    assert example_page(page, g) == "<p>a</p>\n<p>b</p>"
    assert example_page(page, None) == "<p>a</p>\n<p>b</p>"
    (tmp_path / "answers").mkdir()
    out, image = g.answer_to_save("XX-test_1")
    path = g.answer_path("XX-test_1")
    path.write_text(json.dumps(out))
    path.with_suffix(".webp").write_bytes(image)
    shown = example_page(page, g)
    assert f'src="/gallery/answers/{path.stem}.webp"' in shown and " hidden" not in shown
    assert "“The ‘A’ plan” by A" in shown
    assert '<a href="https://l" rel="noopener">CC0 1.0</a>' in shown
    assert "Changes: resized, cropped, dimmed, marks, ways out and route drawn on top." in shown
    assert "shared under the same licence" in shown
    # The image URL is the one the plan opens with, so the browser loads it once.
    client = TestClient(create_app(None, use_env=False, gallery=g))
    assert client.post("/api/gallery/XX-test_1").json()["image"] == f"/gallery/answers/{path.stem}.webp"
    # After a code change the old image is not shown.
    g.code = "other"
    assert "<figure" not in example_page(page, g)


def test_start_page_example_markup():
    from hereout.app import EXAMPLE_CREDIT, EXAMPLE_PHOTO, EXAMPLE_TAG, WEB
    page = (WEB / "index.html").read_text()
    assert page.count(EXAMPLE_TAG) == 1 and EXAMPLE_CREDIT in page and f'src="{EXAMPLE_PHOTO}"' in page
    m = re.search(r'data-sample="([\w-]+)" data-start="(\d+),(\d+)"', page)
    assert m and f'href="/?sample={m[1]}"' in page
    assert (WEB / "example-marks.webp").read_bytes()[8:12] == b"WEBP"
    # Without a gallery the start page has no example.
    assert "example-photo" not in TestClient(create_app(None, use_env=False)).get("/").text


def test_demo_video_needs_the_file_and_the_credits(tmp_path):
    from hereout.app import DEMO_CREDITS, DEMO_LINK, DEMO_TAG, WEB, demo_page
    (tmp_path / "g").mkdir()
    g = make_gallery(tmp_path / "g")
    page = (f'<p>a</p>\n{DEMO_LINK}><a href="#demo">Demo</a></p>\n'
            f'{DEMO_TAG} data-samples="XX-test_1"><video src="/video/demo.mp4"></video>'
            f'{DEMO_CREDITS}</section>\n<p>b</p>')
    video = tmp_path / "v"
    video.mkdir()
    # No file: the block goes.
    assert demo_page(page, video, g) == "<p>a</p>\n<p>b</p>"
    (video / "demo.mp4").write_bytes(b"\0" * 64)
    assert demo_page(page, video, None) == "<p>a</p>\n<p>b</p>"
    shown = demo_page(page, video, g)
    assert " hidden" not in shown and 'src="/video/demo.mp4?v=40' in shown and "poster=" not in shown
    assert DEMO_LINK in shown
    assert "cropped, dimmed, marks, ways out and route drawn on top, shown in a recording of the HereOut page" in shown
    # A plan that the gallery does not know has no credit: the block goes.
    assert demo_page(page.replace("XX-test_1", "XX-gone"), video, g) == "<p>a</p>\n<p>b</p>"
    (video / "demo-poster.webp").write_bytes(b"RIFF")
    assert 'poster="/video/demo-poster.webp?v=' in demo_page(page, video, g)
    # The page has one block, and the server serves the file with ranges for Safari.
    real = (WEB / "index.html").read_text()
    assert real.count(DEMO_TAG) == 1 and real.count(DEMO_LINK) == 1 and DEMO_CREDITS in real and 'src="/video/demo.mp4"' in real
    client = TestClient(create_app(None, use_env=False, gallery=g, video=video))
    r = client.get("/video/demo.mp4", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and len(r.content) == 10
    assert 'id="demo' not in TestClient(create_app(None, use_env=False)).get("/").text


def test_example_plays_the_loop(tmp_path):
    from hereout.app import EXAMPLE_CREDIT, EXAMPLE_PIC, EXAMPLE_TAG, WEB, example_page
    (tmp_path / "g").mkdir()
    g = make_gallery(tmp_path / "g")
    page = (f'<p>a</p>\n{EXAMPLE_TAG} data-sample="XX-test_1" data-start="1,2"><a id="example-open">'
            f'<span class="example-pic" style="--w: 1%">\n<img class="example-photo" src="/gallery/example-photo">\n</span>\n'
            f'<span class="example-bar">Example</span></a>\n    {EXAMPLE_CREDIT}</figure>\n<p>b</p>')
    video = tmp_path / "v"
    video.mkdir()
    # No loop and no saved image: the example goes.
    assert example_page(page, g, video) == "<p>a</p>\n<p>b</p>"
    (video / "hero-loop.mp4").write_bytes(b"\0" * 32)
    shown = example_page(page, g, video)
    assert 'class="example hero has-loop"' in shown and "example-photo" not in shown
    assert '<video id="hero-loop" class="loop" muted loop playsinline preload="metadata"' in shown
    assert 'aria-hidden="true"' in shown and 'src="/video/hero-loop.mp4?v=20' in shown
    assert "poster=" not in shown and "video/webm" not in shown
    # The button that pauses the motion, outside the link; the credit names the recording.
    assert shown.index('id="loop-toggle"') > shown.index("</a>")
    assert "Changes: cropped, dimmed, marks, ways out and route drawn on top, shown in a recording of the HereOut page." in shown
    (video / "hero-loop.webp").write_bytes(b"RIFF")
    (video / "hero-loop.webm").write_bytes(b"\0")
    shown = example_page(page, g, video)
    assert 'poster="/video/hero-loop.webp?v=' in shown and shown.index("video/webm") < shown.index("video/mp4")
    # Without JS the poster shows in place of the video (style.css hides the video).
    assert '<noscript><img class="loop-still" src="/video/hero-loop.webp?v=' in shown
    # A plan that the gallery does not know: no loop, no example.
    assert "<figure" not in example_page(page.replace("XX-test_1", "XX-gone"), g, video)
    # The real page has the one picture that the loop takes the place of.
    real = (WEB / "index.html").read_text()
    assert len(EXAMPLE_PIC.findall(real)) == 1 and 'id="example-open"' in real
    m = re.search(r'data-sample="([\w-]+)"', real)
    shown = example_page(real.replace(m[1], "XX-test_1"), g, video)
    assert 'id="hero-loop"' in shown and "example-photo" not in shown and 'id="example-open"' in shown


def test_counts_in_the_start_page(tmp_path):
    """The row of counts is in the page from the server, so the hero does not move when the gallery comes."""
    from hereout.app import WEB, proof_page
    real = (WEB / "index.html").read_text()
    assert proof_page(real, None) == real
    shown = proof_page(real, make_gallery(tmp_path))
    assert '<p id="proof" class="proof js-only">' in shown
    assert '<b id="proof-plans">1</b>' in shown and '<b id="proof-countries">0</b>' in shown
    assert 'proof-langs' not in shown  # the card languages are not a count of the samples (copy review)
    assert '<span id="gallery-count">1</span>' in shown


def test_start_page_links_and_credits_page(tmp_path):
    from hereout.app import NAV_DEMO, WEB, demo_page
    real = (WEB / "index.html").read_text()
    # The header links to the parts of the page and to the code; the demo link goes with the demo.
    assert 'href="#how"' in real and 'id="how"' in real and 'href="#gallery-wrap"' in real
    assert 'href="https://gitlab.com/devrives/hereout"' in real and real.count(NAV_DEMO) == 1
    assert NAV_DEMO not in demo_page(real, None, None) and 'href="#how"' in demo_page(real, None, None)
    # One disclosure on the start page: the text of the video. The credits have their own page.
    assert real.count("<details") == 1 and 'href="/credits"' in real
    assert "<footer" not in real
    (tmp_path / "g").mkdir()
    client = TestClient(create_app(None, use_env=False, gallery=make_gallery(tmp_path / "g")))
    page = client.get("/credits").text
    assert '<li id="XX-test_1"><a href="/?sample=XX-test_1">Sample plan 1</a> · Photo: “T” by A, CC0 1.0' in page
    assert page.count("<li id=") == 1 and '/static/style.css?v=' in page
    assert TestClient(create_app(None, use_env=False)).get("/credits").status_code == 404
