"""Run the full pipeline on a set of plan photos and save each result.

Usage:
  uv run --env-file .env python scripts/run_set.py INDEX.csv OUT_DIR [--workers 4] [--limit N] [--retry-errors]

INDEX.csv has one row per photo: zip_name (path relative to the CSV folder),
country, licence, author, title, url, readable, security_sensitive. Only rows
with readable=yes and security_sensitive other than yes are used.

OUT_DIR gets, for each photo:
  plans/<id>.jpg   the flat plan image that every coordinate refers to
  thumbs/<id>.jpg  a small preview
  items/<id>.json  credit, model reading, route result, cost and time
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

from hereout.pipeline import decode_photo, plan_route, prepare, read_marks
from hereout.reader import ModelClient

THUMB_SIDE = 360
RETRIES = 3

LICENCE_URLS = {
    "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "cc pdm 1.0": "https://creativecommons.org/publicdomain/mark/1.0/",
    "cc by 2.0": "https://creativecommons.org/licenses/by/2.0/",
    "cc by 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "cc by-sa 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
    "cc by-sa 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "cc by-sa 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
}
LICENCE_NAMES = {"cc0": "CC0 1.0", "cc pdm 1.0": "Public Domain Mark 1.0"}


def credit(row: dict) -> dict:
    key = row["licence"].strip().lower()
    title = row["title"].strip().strip('"')
    if title.startswith("File:"):
        title = title[5:].rsplit(".", 1)[0]
    return {
        "title": title,
        "author": row["author"].strip(),
        "licence": LICENCE_NAMES.get(key, row["licence"].strip().upper()),
        "licence_url": LICENCE_URLS.get(key, ""),
        "source_url": row["url"].strip(),
    }


def usable(row: dict) -> bool:
    return row["readable"].strip() == "yes" and row["security_sensitive"].strip() != "yes"


def item_id(row: dict) -> str:
    return row["zip_name"].rsplit(".", 1)[0].replace("/", "-")


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

    item = {"id": pid, "country": row["country"].strip(), "credit": credit(row),
            "size": [w, h], "seconds": round(took, 1), "error": err,
            "reading": None, "route_found": False, "route_error": None, "steps": 0}
    if reading:
        item["reading"] = {
            "you_are_here": reading.you_are_here, "exits": reading.exits,
            "plan_box": reading.plan_box, "notes": reading.notes,
        }
        item["cost_usd"] = round(reading.cost_usd, 5)
        if reading.you_are_here and reading.exits:
            result = plan_route(plan, reading.you_are_here, [(e["x"], e["y"]) for e in reading.exits])
            item["route_found"] = result["route"] is not None
            item["route_error"] = result["route_error"]
            item["steps"] = len(result["steps"])
        else:
            item["route_error"] = "no you-are-here mark" if not reading.you_are_here else "no exits"
    if err != "spend cap reached":
        with lock:
            (out / "items" / f"{pid}.json").write_text(json.dumps(item, ensure_ascii=False))
    return item


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("index")
    ap.add_argument("out")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--retry-errors", action="store_true")
    args = ap.parse_args()

    index, out = Path(args.index), Path(args.out)
    for sub in ("plans", "thumbs", "items"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    rows = [r for r in csv.DictReader(open(index, encoding="utf-8-sig")) if usable(r)]

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
