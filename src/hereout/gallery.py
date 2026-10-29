"""Open-licensed plan photos with saved readings, for the demo gallery.

The folder is made by scripts/run_set.py and lives outside the repository.
Opening a gallery plan uses the saved model reading, so it costs nothing and
answers at once.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import cv2

from .ink_walls import text_boxes
from .pipeline import Plan
from .reader import Reading

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class Gallery:
    def __init__(self, folder: Path, thumbs_url: str = "/gallery/thumbs"):
        self.folder = folder
        self.thumbs_url = thumbs_url
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
