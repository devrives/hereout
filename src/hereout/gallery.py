"""Open-licensed plan photos with saved readings, for the demo gallery.

The folder is made by scripts/run_set.py and lives outside the repository.
Opening a gallery plan uses the saved model reading, so it costs nothing.
scripts/save_answers.py saves the whole answer of each plan ahead of time, so a
plan opens at once: finding the walls takes seconds on the server's one CPU.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import cv2

from .ink_walls import text_boxes
from .pipeline import Plan, answer
from .reader import Reading

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def code_hash() -> str:
    """A hash of the server code. A saved answer is good only for the code that made it."""
    h = hashlib.sha256()
    for p in sorted(Path(__file__).parent.glob("*.py")):
        h.update(p.name.encode() + b"\0" + p.read_bytes())
    return h.hexdigest()


class Gallery:
    def __init__(self, folder: Path, thumbs_url: str = "/gallery/thumbs"):
        self.folder = folder
        self.thumbs_url = thumbs_url
        self.code = code_hash()
        self.items: dict[str, dict] = {}
        for p in sorted((folder / "items").glob("*.json")):
            item = json.loads(p.read_text())
            if item.get("reading") and ID_RE.match(item["id"]) and (folder / "plans" / f"{item['id']}.jpg").exists():
                self.items[item["id"]] = item

    def listing(self) -> list[dict]:
        """Public fields only. Plans with a route come first, and countries
        take turns, so the first rows show many countries."""
        rows = [{
            "id": i["id"],
            "country": i["country"],
            "credit": i["credit"],
            "route_found": i["route_found"],
            "thumb": f"{self.thumbs_url}/{i['id']}.jpg",
        } for i in self.items.values()]
        rows.sort(key=lambda r: (not r["route_found"], r["country"], r["id"]))
        out = []
        for found in (True, False):
            by_country: dict[str, list[dict]] = {}
            for r in rows:
                if r["route_found"] == found:
                    by_country.setdefault(r["country"], []).append(r)
            queues = sorted(by_country.values(), key=len, reverse=True)
            while any(queues):
                for q in queues:
                    if q:
                        out.append(q.pop(0))
        return out

    def open(self, pid: str) -> tuple[Plan, Reading, dict] | None:
        item = self.items.get(pid)
        if item is None:
            return None
        image = cv2.imread(str(self.folder / "plans" / f"{pid}.jpg"), cv2.IMREAD_COLOR)
        if image is None:
            return None
        r = item["reading"]
        reading = Reading(
            exits=r.get("exits") or [],
            notes=r.get("notes", ""),
            plan_box=tuple(r["plan_box"]) if r.get("plan_box") else None,
        )
        # Saved text boxes spare the OCR on each open.
        text = item.get("text_boxes")
        text = text_boxes(image) if text is None else text
        return Plan.of_reading(image, reading, text), reading, item

    def answer(self, pid: str) -> dict | None:
        """The answer for a gallery plan, found now: the walls take seconds."""
        found = self.open(pid)
        if found is None:
            return None
        plan, reading, item = found
        out = answer(f"g-{pid}", plan, reading, None)
        out["credit"] = item["credit"]
        return out

    def answer_path(self, pid: str) -> Path:
        """Where the saved answer for the current code, item and image goes."""
        h = hashlib.sha256(self.code.encode())
        h.update(json.dumps(self.items[pid], sort_keys=True).encode())
        h.update((self.folder / "plans" / f"{pid}.jpg").read_bytes())
        return self.folder / "answers" / f"{pid}.{h.hexdigest()[:24]}.json"

    def saved_answer(self, pid: str) -> bytes | None:
        """The saved answer as JSON, or None when there is none for the current code."""
        if pid not in self.items:
            return None
        try:
            return self.answer_path(pid).read_bytes()
        except OSError:
            return None
