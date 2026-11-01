"""Run the full pipeline on a set of plan photos and save each result.

Usage:
  uv run --env-file .env python scripts/run_set.py INDEX.csv OUT_DIR [--workers 4] [--limit N] [--retry-errors]
  uv run python scripts/run_set.py INDEX.csv OUT_DIR --refresh

--refresh makes no model call. It flattens each photo again with the current
code. When the flat plan changed, it deletes the saved result, so the next run
reads that photo again. Otherwise it writes the credit again and checks the
ways out again from the saved reading with the current wall and route code.
The check runs on the saved plan image, the same image the browser gets. The
model gives no start, so the check is the share of open floor with a way out.

INDEX.csv has one row per photo: zip_name (path relative to the CSV folder),
country, licence, author, title, url, readable, security_sensitive. Only rows
with readable=yes and security_sensitive other than yes are used.

OUT_DIR gets, for each photo:
  plans/<id>.jpg   the flat plan image that every coordinate refers to
  thumbs/<id>.jpg  a small preview
  items/<id>.json  credit, model reading ("reading": the exits after the code,
                   "read": the points of the model and the second look), route result,
                   cost and time
A photo with a saved result is skipped, so a stopped run can go on.
OUT_DIR must be outside the repository: the photos belong to their authors.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np

from hereout.photo_map import is_photo_map
from hereout.pipeline import Plan, decode_photo, model_reading, prepare, read_marks
from hereout.reader import ModelClient, Reading
from hereout.route import Field, blocked_grid, soft_grid

THUMB_SIDE = 360
RETRIES = 3
OPEN_WITH_WAY = 0.5  # a plan passes when this share of its open floor has a way out

LICENCE_URLS = {
    "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "cc pdm 1.0": "https://creativecommons.org/publicdomain/mark/1.0/",
    "public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "cc by 2.0": "https://creativecommons.org/licenses/by/2.0/",
    "cc by 3.0": "https://creativecommons.org/licenses/by/3.0/",
    "cc by 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "cc by-sa 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
    "cc by-sa 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "cc by-sa 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "cc by-sa 3.0 de": "https://creativecommons.org/licenses/by-sa/3.0/de/",
}
LICENCE_NAMES = {"cc0": "CC0 1.0", "cc pdm 1.0": "Public Domain Mark 1.0", "public domain": "Public domain"}


def credit(row: dict) -> dict:
    key = row["licence"].strip().lower()
    if key not in LICENCE_URLS:
        raise ValueError(f"unknown licence {row['licence']!r}: add it to LICENCE_URLS")
    title = row["title"].strip().strip('"')
    if title.startswith("File:"):
        title = title[5:].rsplit(".", 1)[0]
    return {
        "title": title,
        "author": row["author"].strip(),
        "licence": LICENCE_NAMES.get(key, row["licence"].strip().upper()),
        "licence_url": LICENCE_URLS.get(key, ""),
        "source_url": row["url"].strip(),
        "share_alike": "by-sa" in key,
    }


def usable(row: dict) -> bool:
    return row["readable"].strip() == "yes" and row["security_sensitive"].strip() != "yes"


def item_id(row: dict) -> str:
    return row["zip_name"].rsplit(".", 1)[0].replace("/", "-")


def route_result(image_path: Path, reading: Reading) -> dict:
    """How much of the open floor has a way out, on the saved plan image as the gallery serves it.
    The model gives no start, so the check looks at every open cell in the floor box."""
    if not reading.exits:
        return {"route_found": False, "route_error": "no exits", "open_with_way": 0.0}
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if is_photo_map(image, reading.plan_box):
        return {"route_found": False, "route_error": "photo map", "open_with_way": 0.0}
    # The walls with the exits, as the page gets them (Plan.use_reading): the
    # doors at the exits open only then. Without them, an exit moved onto its
    # door by the zoom check closed most of the floor.
    plan = Plan.of(image, reading.plan_box, exits=reading.exits)
    blocked, scale = blocked_grid(plan.walls)
    field = Field(blocked, scale, [(e["x"], e["y"]) for e in reading.exits], soft=soft_grid(plan.soft, blocked))
    owner = np.array(field.owner).reshape(blocked.shape)
    inside = ~blocked
    if reading.plan_box:
        x0, y0, x1, y1 = (int(v * scale) for v in reading.plan_box)
        box = np.zeros_like(inside)
        box[y0:y1 + 1, x0:x1 + 1] = True
        inside &= box
    share = float((owner[inside] >= 0).mean()) if inside.any() else 0.0
    found = share >= OPEN_WITH_WAY
    return {"route_found": found, "route_error": None if found else "most open floor has no way out",
            "open_with_way": round(share, 3)}


def run_one(row: dict, base: Path, out: Path, client: ModelClient, lock: threading.Lock) -> dict:
    pid = item_id(row)
    photo = decode_photo((base / row["zip_name"]).read_bytes())
    plan = prepare(photo)
    h, w = plan.image.shape[:2]
    cv2.imwrite(str(out / "plans" / f"{pid}.jpg"), plan.image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    f = THUMB_SIDE / max(h, w)
    thumb = cv2.resize(plan.image, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(out / "thumbs" / f"{pid}.jpg"), thumb, [cv2.IMWRITE_JPEG_QUALITY, 80])

    t = time.monotonic()
    reading, err = None, None
    for attempt in range(RETRIES):
        reading, err = read_marks(plan, client)
        if reading or err in ("spend cap reached", "model not configured"):
            break
        if err and ("status 429" in err or "status 5" in err or "request failed" in err):
            time.sleep(5 * (attempt + 1))
            continue
        break
    took = time.monotonic() - t

    item = {"id": pid, "country": row["country"].strip(), "credit": {**credit(row), "changes": plan.changes},
            "size": [w, h], "seconds": round(took, 1), "error": err,
            "reading": None, "route_found": False, "route_error": None, "open_with_way": 0.0}
    if reading:
        item["reading"] = {
            "exits": reading.exits,
            "plan_box": reading.plan_box, "notes": reading.notes,
        }
        # What Muse Spark gave, the second look on it and what the code did with each exit
        # (pipeline.model_reading), so scripts/score_exits.py --points model can score the model alone.
        item["read"] = model_reading(reading)
        item["cost_usd"] = round(reading.cost_usd, 5)
        item.update(route_result(out / "plans" / f"{pid}.jpg", reading))
    if err != "spend cap reached":
        with lock:
            (out / "items" / f"{pid}.json").write_text(json.dumps(item, ensure_ascii=False))
    return item


def refresh(rows: list[dict], base: Path, out: Path) -> None:
    stale = kept = 0
    for row in rows:
        pid = item_id(row)
        path = out / "items" / f"{pid}.json"
        if not path.exists():
            continue
        plan = prepare(decode_photo((base / row["zip_name"]).read_bytes()))
        saved = cv2.imread(str(out / "plans" / f"{pid}.jpg"), cv2.IMREAD_COLOR)
        same = saved is not None and saved.shape == plan.image.shape and \
            float(np.abs(saved.astype(int) - plan.image.astype(int)).mean()) < 6
        if not same:
            path.unlink()
            stale += 1
            print(f"stale: {pid}", flush=True)
            continue
        item = json.loads(path.read_text())
        item["credit"] = {**credit(row), "changes": plan.changes}
        r = item.get("reading")
        if r:
            r.pop("you_are_here", None)
            item.pop("steps", None)
            reading = Reading(exits=r.get("exits") or [], plan_box=tuple(r["plan_box"]) if r.get("plan_box") else None)
            plan.use_reading(reading)
            item.update(route_result(out / "plans" / f"{pid}.jpg", reading))
        path.write_text(json.dumps(item, ensure_ascii=False))
        kept += 1
    print(f"refresh: {kept} kept, {stale} to read again", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("index")
    ap.add_argument("out")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--retry-errors", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    index, out = Path(args.index), Path(args.out)
    for sub in ("plans", "thumbs", "items"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    rows = [r for r in csv.DictReader(open(index, encoding="utf-8-sig")) if usable(r)]
    if args.refresh:
        refresh(rows, index.parent, out)
        return 0

    def done(r):
        p = out / "items" / f"{item_id(r)}.json"
        if not p.exists():
            return False
        return not (args.retry_errors and json.loads(p.read_text()).get("error"))

    todo = [r for r in rows if not done(r)]
    if args.limit:
        todo = todo[: args.limit]
    client = ModelClient.from_env()
    if client is None:
        print("BASETEN key missing", file=sys.stderr)
        return 1
    print(f"{len(rows)} usable, {len(todo)} to run", flush=True)

    lock = threading.Lock()
    n_ok = n = 0
    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(run_one, r, index.parent, out, client, lock): r for r in todo}
        for fut in as_completed(futures):
            n += 1
            try:
                item = fut.result()
            except Exception as e:  # one bad photo must not stop the run
                print(f"[{n}/{len(todo)}] {item_id(futures[fut])} FAILED {type(e).__name__}: {e}", flush=True)
                continue
            n_ok += item["route_found"]
            print(f"[{n}/{len(todo)}] {item['id']} route={item['route_found']} "
                  f"err={item['error'] or item['route_error']} {item['seconds']}s", flush=True)
            if item["error"] == "spend cap reached":
                print("spend cap reached; stopping", flush=True)
                pool.shutdown(cancel_futures=True)
                break
    print(f"done: {n} run, {n_ok} with a route; ledger {client.ledger.snapshot()}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
