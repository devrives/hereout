"""The words of a plan in the user's language.

The plan text read (reader.TEXT_PROMPT) gives the title, the legend and the
instructions of a plan, each with its original text and an English text. The
model labels of the exits are short English texts. One text-only Muse Spark
call translates all of them into one language. The answers of gallery plans
stay in a disk cache, keyed by a hash of the texts and the language. The
answers for photos stay in memory only, with the other data of the photo.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

# The languages of the plan card (web/i18n/<tag>.json), with the English name
# that the translation prompt uses. English needs no call.
LANGS = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian",
    "pt": "Portuguese", "ru": "Russian", "uk": "Ukrainian", "ja": "Japanese", "ko": "Korean",
    "zh-Hans": "Simplified Chinese", "hi": "Hindi", "ar": "Arabic",
}
# Change with TRANSLATE_PROMPT: the cache then gives no old answers.
VERSION = "1"
# A label that only says "exit" shows as "Exit <n>" (app.js exitName); a number needs no words.
PLAIN_LABEL = re.compile(r"^\s*(exit|[\d.]*)\s*$", re.I)


def labels_of(exits: list[dict]) -> list[str]:
    """The exit labels that need a translation, once each, in order."""
    out = []
    for e in exits:
        label = str(e.get("label", "")).strip()
        if label and not PLAIN_LABEL.match(label) and label not in out:
            out.append(label)
    return out


def items_of(plan_text: dict | None, labels: list[str]) -> list[dict]:
    """The texts to translate, as [{"id", "text", "original"?}]."""
    items = []

    def add(i: str, e: dict) -> None:
        item = {"id": i, "text": e["english"]}
        if e.get("original") and e["original"] != e["english"]:
            item["original"] = e["original"]
        items.append(item)

    if plan_text:
        if plan_text.get("title"):
            add("title", plan_text["title"])
        for key in ("legend", "instructions"):
            for n, e in enumerate(plan_text.get(key) or []):
                add(f"{key[0]}{n}", e)
    for n, label in enumerate(labels):
        items.append({"id": f"x{n}", "text": label})
    return items


def apply(plan_text: dict | None, labels: list[str], lang: str, done: dict[str, str]) -> dict:
    """The answer for the page: the plan text with a "text" in the language for
    each item (the English text where no translation came), and the labels as
    {English label: label in the language}."""
    def put(i: str, e: dict) -> dict:
        return {**e, "text": done.get(i) or e["english"]}

    out = None
    if plan_text:
        out = {"language": plan_text.get("language", ""),
               "title": put("title", plan_text["title"]) if plan_text.get("title") else None}
        for key in ("legend", "instructions"):
            out[key] = [put(f"{key[0]}{n}", e) for n, e in enumerate(plan_text.get(key) or [])]
    return {"lang": lang, "plan_text": out,
            "labels": {label: done[f"x{n}"] for n, label in enumerate(labels) if done.get(f"x{n}")}}


def cache_key(items: list[dict], lang: str, model: str) -> str:
    blob = json.dumps({"v": VERSION, "model": model, "lang": lang, "items": items},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


class DiskCache:
    """Translations by key, one JSON file each. A file that does not read is a
    miss. With no folder, the cache is in memory (tests)."""

    def __init__(self, folder: Path | None):
        self.folder = folder
        self._mem: dict[str, dict[str, str]] = {}

    @classmethod
    def from_env(cls) -> "DiskCache":
        return cls(Path(os.environ.get("HEREOUT_TEXT_CACHE", ".cache/translations")))

    def get(self, key: str) -> dict[str, str] | None:
        if self.folder is None:
            return self._mem.get(key)
        try:
            data = json.loads((self.folder / f"{key}.json").read_text())
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def put(self, key: str, value: dict[str, str]) -> None:
        if self.folder is None:
            self._mem[key] = value
            return
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            tmp = self.folder / f"{key}.tmp{os.getpid()}"
            tmp.write_text(json.dumps(value, ensure_ascii=False))
            os.replace(tmp, self.folder / f"{key}.json")
        except OSError:
            pass  # a cache that cannot be written only costs a call the next time
