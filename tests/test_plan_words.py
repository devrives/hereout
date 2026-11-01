"""The words on the plan in the user's language: the text read, the
translation endpoint, its cache and its checks. No network: fake clients."""

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from hereout.app import create_app
from hereout.gallery import Gallery
from hereout.reader import (ModelClient, ModelError, Prices, Reading, SpendLedger, TEXT_ITEMS,
                            parse_plan_text, parse_translation)
from hereout.translate import LANGS, DiskCache, apply, cache_key, items_of, labels_of

from conftest import draw_plan
from test_app import make_gallery, read

WEB = Path(__file__).parent.parent / "src" / "hereout" / "web"
NODE = shutil.which("node")

PLAN_TEXT = {
    "language": "ru",
    "title": {"original": "ПЛАН ЭВАКУАЦИИ", "english": "Evacuation plan"},
    "legend": [{"original": "путь эвакуации", "english": "evacuation route"}],
    "instructions": [{"original": "Лифтом не пользоваться", "english": "Do not use the lift"}],
}


# The text read

def test_parse_plan_text():
    text = json.dumps({**PLAN_TEXT, "legend": [*PLAN_TEXT["legend"], {"original": "", "english": ""}, "Выход"]})
    got = parse_plan_text("Here it is: " + text)
    assert got["language"] == "ru"
    assert got["title"] == PLAN_TEXT["title"]
    # An empty item goes; a bare string is an original with the same English.
    assert got["legend"] == [PLAN_TEXT["legend"][0], {"original": "Выход", "english": "Выход"}]
    assert got["instructions"] == PLAN_TEXT["instructions"]


def test_parse_plan_text_cleans_and_caps():
    many = [{"original": f"— Пункт {i}", "english": f"Item  {i}"} for i in range(20)]
    got = parse_plan_text(json.dumps({"language": "not a tag!", "title": None, "legend": many,
                                      "instructions": [{"original": "x" * 500}] * 3}))
    assert got["language"] == "" and got["title"] is None
    # The instructions come first; the legend fills the rest.
    assert len(got["instructions"]) == 3 and len(got["legend"]) == TEXT_ITEMS - 3
    assert got["legend"][0] == {"original": "Пункт 0", "english": "Item 0"}
    assert len(got["instructions"][0]["original"]) == 200 and got["instructions"][0]["english"] == "x" * 200


def test_parse_plan_text_needs_json():
    for bad in ("no json", "{bad json}", "[1, 2]"):
        with pytest.raises(ModelError):
            parse_plan_text(bad)


def test_parse_translation():
    got = parse_translation('{"t1": " Выход ", "t2": 5, "t3": ""}', ["t1", "t2", "t3", "t4"])
    assert got == {"t1": "Выход"}
    with pytest.raises(ModelError):
        parse_translation("none", ["t1"])


def client_with(answer: str, tmp_path, calls=None):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if calls is not None:
            calls.append(body)
        return httpx.Response(200, json={"choices": [{"message": {"content": answer}}],
                                         "usage": {"prompt_tokens": 1000, "completion_tokens": 200}})
    ledger = SpendLedger(tmp_path / "spend.json", 1.0)
    return ModelClient("k", ledger, prices=Prices(1.0, 1.0), transport=httpx.MockTransport(handler)), ledger


def test_read_text_and_translate_go_through_the_ledger(tmp_path):
    calls = []
    client, ledger = client_with(json.dumps(PLAN_TEXT), tmp_path, calls)
    words, cost = client.read_text(np.full((50, 50, 3), 255, np.uint8))
    assert words["title"]["english"] == "Evacuation plan" and cost == pytest.approx(0.0012)
    assert calls[0]["messages"][0]["content"][1]["type"] == "image_url"
    client2, ledger2 = client_with('{"t0": "Ausgang"}', tmp_path / "b", calls)
    done, _ = client2.translate([{"id": "t0", "text": "Exit"}], "de", "German")
    assert done == {"t0": "Ausgang"}
    # Text only: no image in the translation call.
    assert len(calls[1]["messages"][0]["content"]) == 1 and "German (de)" in calls[1]["messages"][0]["content"][0]["text"]
    assert ledger.snapshot()["calls"] == 1 and ledger2.snapshot()["calls"] == 1


# The texts and the cache

def test_labels_items_and_apply():
    labels = labels_of([{"label": "EXIT"}, {"label": "3"}, {"label": "Stairs east"}, {"label": "Stairs east"}, {"label": ""}])
    assert labels == ["Stairs east"]
    items = items_of(PLAN_TEXT, labels)
    assert [i["id"] for i in items] == ["title", "l0", "i0", "x0"]
    assert items[0] == {"id": "title", "text": "Evacuation plan", "original": "ПЛАН ЭВАКУАЦИИ"}
    out = apply(PLAN_TEXT, labels, "de", {"title": "Fluchtplan", "x0": "Treppe Ost"})
    assert out["plan_text"]["title"]["text"] == "Fluchtplan"
    assert out["plan_text"]["legend"][0]["text"] == "evacuation route"  # no translation: the English text
    assert out["plan_text"]["instructions"][0]["original"] == "Лифтом не пользоваться"
    assert out["labels"] == {"Stairs east": "Treppe Ost"}
    assert apply(None, [], "de", {}) == {"lang": "de", "plan_text": None, "labels": {}}


def test_cache_key_and_disk_cache(tmp_path):
    items = items_of(PLAN_TEXT, [])
    assert cache_key(items, "de", "m") != cache_key(items, "fr", "m")
    assert cache_key(items, "de", "m") != cache_key(items[:1], "de", "m")
    assert cache_key(items, "de", "m") != cache_key(items, "de", "other")
    cache = DiskCache(tmp_path / "c")
    assert cache.get("k") is None
    cache.put("k", {"title": "Fluchtplan"})
    assert DiskCache(tmp_path / "c").get("k") == {"title": "Fluchtplan"}
    (tmp_path / "c" / "bad.json").write_text("{not json")
    assert cache.get("bad") is None


def test_languages_match_the_catalogues():
    files = {p.stem for p in (WEB / "i18n").glob("*.json")}
    assert files == set(LANGS) - {"en"}


# The endpoint

class FakeModel:
    """A model client with a text read and a translation, and a count of the calls."""
    model = "fake"

    def __init__(self, words=PLAN_TEXT, wait=0.0, fail=False):
        self.words, self.wait, self.fail = words, wait, fail
        self.translations = []

    def read_plan(self, img):
        _, _, exit_ = draw_plan()
        return Reading([{"x": exit_[0], "y": exit_[1], "label": "Stairs east"}])

    def read_text(self, img):
        time.sleep(self.wait)
        if self.fail:
            raise ModelError("request failed: ReadTimeout")
        return self.words, 0.0

    def translate(self, items, tag, name):
        self.translations.append(tag)
        return {i["id"]: f"[{tag}] {i['text']}" for i in items}, 0.0


def with_words(tmp_path):
    """The test gallery, with the words of its plan, as scripts/read_text.py stores them."""
    folder = tmp_path / "g"
    if not folder.exists():
        folder.mkdir()
        make_gallery(folder)
        path = folder / "items" / "XX-test_1.json"
        item = json.loads(path.read_text())
        item["plan_text"] = PLAN_TEXT
        item["reading"]["exits"][0]["label"] = "Stairs east"
        path.write_text(json.dumps(item))
    return Gallery(folder)


def test_gallery_words_english_needs_no_call(tmp_path):
    model = FakeModel()
    client = TestClient(create_app(model, use_env=False, gallery=with_words(tmp_path)))
    plan = client.post("/api/gallery/XX-test_1").json()
    assert plan["text_id"] == "g-XX-test_1" and plan["plan_text"] == PLAN_TEXT
    r = client.get("/api/text/g-XX-test_1?lang=en")
    assert r.status_code == 200 and r.json()["plan_text"]["title"]["text"] == "Evacuation plan"
    assert model.translations == []


def test_gallery_words_translated_once_then_cached(tmp_path):
    model = FakeModel()
    cache = DiskCache(tmp_path / "cache")
    app = create_app(model, use_env=False, gallery=with_words(tmp_path), text_cache=cache)
    data = TestClient(app).get("/api/text/g-XX-test_1?lang=ko").json()
    assert data["lang"] == "ko"
    assert data["plan_text"]["instructions"][0]["text"] == "[ko] Do not use the lift"
    assert data["labels"] == {"Stairs east": "[ko] Stairs east"}
    assert len(list((tmp_path / "cache").glob("*.json"))) == 1
    # A new server reads the disk cache: no second call.
    app2 = create_app(model, use_env=False, gallery=with_words(tmp_path), text_cache=DiskCache(tmp_path / "cache"))
    assert TestClient(app2).get("/api/text/g-XX-test_1?lang=ko").json() == data
    assert model.translations == ["ko"]


def test_words_checks(tmp_path):
    model = FakeModel()
    client = TestClient(create_app(model, use_env=False, gallery=with_words(tmp_path)))
    assert client.get("/api/text/g-XX-test_1?lang=tlh").status_code == 400
    assert client.get("/api/text/g-XX-test_1?lang=zh").status_code == 400
    assert client.get("/api/text/g-nothing?lang=ko").status_code == 404
    assert client.get("/api/text/p-nothing?lang=ko").status_code == 404
    assert client.get("/api/text/other?lang=ko").status_code == 404
    assert model.translations == []
    # No model: no translation, and no answer that looks like one.
    plain = TestClient(create_app(None, use_env=False, gallery=with_words(tmp_path)))
    assert plain.get("/api/text/g-XX-test_1?lang=ko").status_code == 503


def test_words_rate_limit(tmp_path, monkeypatch):
    monkeypatch.setattr("hereout.app.TRANSLATIONS_PER_WINDOW", 2)
    model = FakeModel()
    client = TestClient(create_app(model, use_env=False, gallery=with_words(tmp_path)))
    assert client.get("/api/text/g-XX-test_1?lang=ko").status_code == 200
    assert client.get("/api/text/g-XX-test_1?lang=ja").status_code == 200
    # A cache hit is not counted; a third call is refused.
    assert client.get("/api/text/g-XX-test_1?lang=ko").status_code == 200
    assert client.get("/api/text/g-XX-test_1?lang=de").status_code == 429
    assert model.translations == ["ko", "ja"]


def test_failed_translation_is_not_cached(tmp_path):
    class Broken(FakeModel):
        def translate(self, items, tag, name):
            self.translations.append(tag)
            raise ModelError("model API status 500")
    model = Broken()
    client = TestClient(create_app(model, use_env=False, gallery=with_words(tmp_path)))
    assert client.get("/api/text/g-XX-test_1?lang=ko").status_code == 502
    assert client.get("/api/text/g-XX-test_1?lang=ko").status_code == 502
    assert model.translations == ["ko", "ko"]


def test_photo_answer_has_its_words(tmp_path):
    model = FakeModel()
    client = TestClient(create_app(model, use_env=False))
    img, _, _ = draw_plan()
    data = read(client, img).json()
    assert data["plan_text"] == PLAN_TEXT and data["text_id"].startswith("p-") and "text_pending" not in data
    tr = client.get(f"/api/text/{data['text_id']}?lang=uk").json()
    assert tr["plan_text"]["title"]["text"] == "[uk] Evacuation plan"
    assert tr["labels"] == {"Stairs east": "[uk] Stairs east"}
    # The second ask comes from memory.
    assert client.get(f"/api/text/{data['text_id']}?lang=uk").json() == tr
    assert model.translations == ["uk"]


def test_photo_opens_without_failed_words(tmp_path):
    client = TestClient(create_app(FakeModel(fail=True), use_env=False))
    img, _, _ = draw_plan()
    data = read(client, img).json()
    assert data["plan_text"] is None and data["exits"]
    r = client.get(f"/api/text/{data['text_id']}?lang=en")
    assert r.status_code == 200 and r.json()["plan_text"] is None


def test_late_words_come_through_the_endpoint(tmp_path, monkeypatch):
    monkeypatch.setattr("hereout.app.WORDS_GRACE", 0.0)
    gate = threading.Event()

    class Slow(FakeModel):
        def read_text(self, img):
            gate.wait(10)
            return self.words, 0.0
    client = TestClient(create_app(Slow(), use_env=False))
    img, _, _ = draw_plan()
    data = read(client, img).json()
    # The plan does not wait for the words.
    assert data["plan_text"] is None and data["text_pending"] is True
    assert client.get(f"/api/text/{data['text_id']}?lang=en").status_code == 202
    gate.set()
    for _ in range(100):
        r = client.get(f"/api/text/{data['text_id']}?lang=en")
        if r.status_code == 200:
            break
        time.sleep(0.02)
    assert r.json()["plan_text"]["title"]["original"] == "ПЛАН ЭВАКУАЦИИ"


def test_page_carries_the_catalogue_hash():
    client = TestClient(create_app(None, use_env=False))
    page = client.get("/").text
    assert 'data-i18n=""' not in page and 'data-i18n="' in page
    assert client.get("/static/i18n/ko.json").json()["exit_n"]


# The catalogue

@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_catalogues_and_step_texts():
    out = subprocess.run([NODE, str(Path(__file__).parent / "i18n_check.js")], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
