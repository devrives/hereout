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

from .pipeline import Plan
from .reader import Reading

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class Gallery:
    def __init__(self, folder: Path):
        self.folder = folder
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
            "thumb": f"/gallery/thumbs/{i['id']}.jpg",
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
            you_are_here=tuple(r["you_are_here"]) if r.get("you_are_here") else None,
            exits=r.get("exits") or [],
            notes=r.get("notes", ""),
            plan_box=tuple(r["plan_box"]) if r.get("plan_box") else None,
        )
        plan = Plan.of(image, reading.plan_box)
        return plan, reading, item
