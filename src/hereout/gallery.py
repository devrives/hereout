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
# The order of the list: plans that read well first, plans with wrong exits
# last. A JSON file, so a new order does not change the key of the saved answers.
ORDER_FILE = Path(__file__).parent / "gallery_order.json"
PLAN_WEBP_QUALITY = 80  # half the bytes of the JPEG in the answer; the marks and the text stay sharp


def code_hash() -> str:
    """A hash of the server code. A saved answer is good only for the code that made it."""
    h = hashlib.sha256()
    for p in sorted(Path(__file__).parent.glob("*.py")):
        h.update(p.name.encode() + b"\0" + p.read_bytes())
    return h.hexdigest()


class Gallery:
    def __init__(self, folder: Path, thumbs_url: str = "/gallery/thumbs", order: dict | None = None):
        self.folder = folder
        order = json.loads(ORDER_FILE.read_text()) if order is None else order
        self.first: list[str] = order.get("first", [])
        self.last: list[str] = order.get("last", [])
        self.thumbs_url = thumbs_url
        self.answers_url = thumbs_url.rsplit("/", 1)[0] + "/answers"
        self.code = code_hash()
        self._paths: dict[tuple[str, str], Path] = {}
        self.items: dict[str, dict] = {}
        for p in sorted((folder / "items").glob("*.json")):
            item = json.loads(p.read_text())
            if item.get("reading") and ID_RE.match(item["id"]) and (folder / "plans" / f"{item['id']}.jpg").exists():
                self.items[item["id"]] = item

    def listing(self) -> list[dict]:
        """Public fields only. The plans of the "first" list come first, in its
        order. Then the other plans with a route, and the countries take turns,
        so the first rows show many countries. The plans of the "last" list
        (wrong exits) and the plans with no route are at the end."""
        rows = {i["id"]: {
            "id": i["id"],
            "country": i["country"],
            "credit": i["credit"],
            "route_found": i["route_found"],
            "thumb": f"{self.thumbs_url}/{i['id']}.jpg",
        } for i in self.items.values()}
        first = [rows[i] for i in dict.fromkeys(self.first) if i in rows and rows[i]["route_found"]]
        placed = {r["id"] for r in first}
        last = [rows[i] for i in dict.fromkeys(self.last) if i in rows and i not in placed and rows[i]["route_found"]]
        placed |= {r["id"] for r in last}
        rest = sorted((r for r in rows.values() if r["id"] not in placed), key=lambda r: (r["country"], r["id"]))
        return (first + self._turns([r for r in rest if r["route_found"]]) + last
                + self._turns([r for r in rest if not r["route_found"]]))

    @staticmethod
    def _turns(rows: list[dict]) -> list[dict]:
        """The rows with the countries in turns, the country with the most plans first."""
        by_country: dict[str, list[dict]] = {}
        for r in rows:
            by_country.setdefault(r["country"], []).append(r)
        queues = sorted(by_country.values(), key=len, reverse=True)
        out = []
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
        found = self._answer(pid)
        return found and found[0]

    def _answer(self, pid: str) -> tuple[dict, Plan] | None:
        found = self.open(pid)
        if found is None:
            return None
        plan, reading, item = found
        out = answer(f"g-{pid}", plan, reading, None)
        out["credit"] = item["credit"]
        # The words on the plan (scripts/read_text.py), as a photo answer has them.
        out["text_id"] = f"g-{pid}"
        out["plan_text"] = item.get("plan_text")
        return out, plan

    def answer_to_save(self, pid: str) -> tuple[dict, bytes] | None:
        """The answer to save, and its plan image as WebP apart from it. The
        answer has the URL of the image: the edge and the browsers keep the
        image, and the answer is small."""
        found = self._answer(pid)
        if found is None:
            return None
        out, plan = found
        ok, buf = cv2.imencode(".webp", plan.image, [cv2.IMWRITE_WEBP_QUALITY, PLAN_WEBP_QUALITY])
        if not ok:
            return None
        out["image"] = f"{self.answers_url}/{self.answer_path(pid).stem}.webp"
        return out, buf.tobytes()

    def answer_path(self, pid: str) -> Path:
        """Where the saved answer for the current code, item and image goes."""
        key = (pid, self.code)
        if key not in self._paths:  # the start page asks for it on each visit (saved_image_url)
            h = hashlib.sha256(self.code.encode())
            h.update(json.dumps(self.items[pid], sort_keys=True).encode())
            h.update((self.folder / "plans" / f"{pid}.jpg").read_bytes())
            self._paths[key] = self.folder / "answers" / f"{pid}.{h.hexdigest()[:24]}.json"
        return self._paths[key]

    def saved_image_url(self, pid: str) -> str | None:
        """The URL of the saved plan image for the current code, or None."""
        if pid not in self.items or not self.answer_path(pid).with_suffix(".webp").exists():
            return None
        return f"{self.answers_url}/{self.answer_path(pid).stem}.webp"

    def saved_answer(self, pid: str) -> bytes | None:
        """The saved answer as JSON, or None when there is none for the current code."""
        if pid not in self.items:
            return None
        path = self.answer_path(pid)
        try:
            data = path.read_bytes()
        except OSError:
            return None
        # The image is in the answer, or it is the file beside it, at the URL of this gallery.
        image = json.loads(data).get("image", "")
        if image.startswith("data:image/"):
            return data
        if image == f"{self.answers_url}/{path.stem}.webp" and path.with_suffix(".webp").exists():
            return data
        return None
