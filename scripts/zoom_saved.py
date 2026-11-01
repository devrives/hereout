"""Run the zoom check (the second look) on the saved reading of each gallery plan.

Usage:
  uv run --env-file .env python scripts/zoom_saved.py GALLERY_DIR [--ids ID ...] [--workers 4]
      [--again] [--max-usd 5] [--dry-run]

A gallery plan opens from its saved main reading, with no model call. Before
this script, the saved readings had no record of the zoom check, so the page
could not show it. For each plan, the script runs the check of the live path
on the saved exits (ModelClient.second_look: the same gate, crops, sheets,
prompt and rules). A call goes only when an exit is suspect. A plan with no
suspect exit gets the record "none" and no call.

It writes, in the gallery folder:
  zoom/<id>-<n>.<hash>.webp  each sheet of numbered crops that the model saw.
                             The name changes with the content, so the server
                             sends the sheets with a long cache.
  items/<id>.json            "reading": "exits" after the check, "trace" (each
                             exit of the main reading and what the check did),
                             "zoom", "sheets". Also "zoom_cost_usd" and
                             "zoom_seconds".
When the check moves or drops an exit, it finds "route_found" and
"open_with_way" again from the new exits, as run_set.py --refresh does.

A plan with a zoom record is skipped, unless --again. With --again, the check
starts again from the exits of the main reading in "trace". A failed call
writes nothing, so the next run tries that plan again. --dry-run lists the
suspect exits and makes no call. After the run, the saved answers are old:
run scripts/save_answers.py on the same folder.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from run_set import route_result  # noqa: E402

from hereout.pipeline import Plan, sheet_webp  # noqa: E402
from hereout.reader import ZOOM_PER_SHEET, ModelClient, Reading, suspect_exits  # noqa: E402

DONE = ("done", "none")  # a zoom record that stays; "failed" is tried again


def main_exits(r: dict) -> list[dict]:
    """The exits of the main reading: the trace of an earlier check, or the saved exits."""
    return [{"x": e["x"], "y": e["y"], "label": e.get("label", "")} for e in (r.get("trace") or r["exits"])]


def route_of(folder: Path, item: dict, image: np.ndarray, exits: list[dict]) -> dict:
    """route_found, route_error and open_with_way for these exits, as run_set.py --refresh finds them."""
    r = item["reading"]
    reading = Reading(exits=[dict(e) for e in exits], plan_box=tuple(r["plan_box"]) if r.get("plan_box") else None)
    Plan(image, np.zeros(image.shape[:2], bool), text=item.get("text_boxes")).use_reading(reading)
    return route_result(folder / "plans" / f"{item['id']}.jpg", reading)


def save_sheets(folder: Path, pid: str, sheets: list[np.ndarray]) -> list[str]:
    """Write the sheets as WebP and delete the older sheets of the plan. Returns the file names."""
    out = folder / "zoom"
    out.mkdir(exist_ok=True)
    names = []
    for n, sheet in enumerate(sheets, 1):
        data = sheet_webp(sheet)
        name = f"{pid}-{n}.{hashlib.sha256(data).hexdigest()[:12]}.webp"
        tmp = out / f".{name}.tmp"
        tmp.write_bytes(data)
        os.replace(tmp, out / name)
        names.append(name)
    for p in out.glob(f"{pid}-*.webp"):
        if p.name not in names and p.name.rsplit("-", 1)[0] == pid:
            p.unlink()
    return names


def zoom_one(folder: Path, pid: str, client: ModelClient) -> dict:
    """Run the check on one plan and save it. Returns a summary for the report."""
    path = folder / "items" / f"{pid}.json"
    item = json.loads(path.read_text())
    r = item["reading"]
    image = cv2.imread(str(folder / "plans" / f"{pid}.jpg"), cv2.IMREAD_COLOR)
    main = main_exits(r)
    reading = Reading(exits=[dict(e) for e in main], notes=r.get("notes", ""),
                      plan_box=tuple(r["plan_box"]) if r.get("plan_box") else None)
    t = time.monotonic()
    client.second_look(image, reading)
    took = time.monotonic() - t
    summary = {"id": pid, "zoom": reading.zoom, "cost_usd": reading.cost_usd, "seconds": round(took, 1),
               "results": [x.get("zoom") and (x["zoom"] if x["zoom"] != "unchanged" else f"unchanged ({x['why']})")
                           for x in reading.trace]}
    if reading.zoom == "failed":
        return summary  # nothing saved: the next run tries again
    names = save_sheets(folder, pid, reading.sheets)
    changed = [(e["x"], e["y"]) for e in reading.exits] != [(e["x"], e["y"]) for e in main]
    if changed:
        before = route_of(folder, item, image, main)
        after = route_of(folder, item, image, reading.exits)
        summary.update(before={k: before[k] for k in ("route_found", "open_with_way")},
                       after={k: after[k] for k in ("route_found", "open_with_way")},
                       saved={k: item.get(k) for k in ("route_found", "open_with_way")})
        item.update(after)
    summary["changed"] = changed
    r.update(exits=reading.exits,
             trace=[{k: list(v) if k in ("to", "seen") else v for k, v in x.items()} for x in reading.trace],
             zoom=reading.zoom, sheets=names)
    item["zoom_cost_usd"] = round(reading.cost_usd, 5)
    item["zoom_seconds"] = summary["seconds"]
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(item, ensure_ascii=False))
    os.replace(tmp, path)
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gallery", type=Path)
    ap.add_argument("--ids", nargs="*", default=None, help="only these plans")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--again", action="store_true", help="also plans with a zoom record")
    ap.add_argument("--max-usd", type=float, default=5.0, help="stop when this run has spent this much")
    ap.add_argument("--dry-run", action="store_true", help="count the suspect exits; no call, no write")
    args = ap.parse_args()

    folder = args.gallery
    items = {}
    for p in sorted((folder / "items").glob("*.json")):
        item = json.loads(p.read_text())
        if item.get("reading") and (args.ids is None or item["id"] in args.ids):
            items[item["id"]] = item
    if args.ids:
        missing = set(args.ids) - set(items)
        if missing:
            print(f"no saved reading: {' '.join(sorted(missing))}", file=sys.stderr)
    todo = [pid for pid, item in items.items() if args.again or item["reading"].get("zoom") not in DONE]

    if args.dry_run:
        plans = exits = sheets = 0
        for pid in todo:
            image = cv2.imread(str(folder / "plans" / f"{pid}.jpg"), cv2.IMREAD_COLOR)
            n = len(suspect_exits(image, main_exits(items[pid]["reading"])))
            plans += n > 0
            exits += n
            sheets += -(-n // ZOOM_PER_SHEET)
            print(f"{pid} {n} suspect")
        print(f"{len(todo)} plans to check: {plans} with a suspect exit (one call each), "
              f"{exits} suspect exits on {sheets} sheets")
        return 0

    client = ModelClient.from_env()
    if client is None:
        print("BASETEN key missing", file=sys.stderr)
        return 1
    # Other runs can share the ledger, so the run counts the cost of its own calls.
    print(f"{len(items)} plans, {len(todo)} to check; ledger {client.ledger.snapshot()['spent_usd']:.4f} USD",
          flush=True)
    failed = changed = 0
    spent = 0.0
    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(zoom_one, folder, pid, client): pid for pid in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                s = fut.result()
            except Exception as e:  # one bad plan must not stop the run
                print(f"[{i}/{len(todo)}] {futures[fut]} FAILED {type(e).__name__}: {e}", flush=True)
                failed += 1
                continue
            failed += s["zoom"] == "failed"
            spent += s["cost_usd"]
            changed += bool(s.get("changed"))
            line = f"[{i}/{len(todo)}] {s['id']} {s['zoom']} {s['cost_usd']:.4f} USD {s['seconds']} s"
            if s.get("results") and s["zoom"] == "done":
                line += " " + ", ".join(f"{n}:{x}" for n, x in enumerate(s["results"], 1) if x)
            if s.get("changed"):
                line += f" | route before {s['before']} after {s['after']} (saved {s['saved']})"
            print(line, flush=True)
            if spent > args.max_usd:
                print(f"--max-usd {args.max_usd} reached; stopping", flush=True)
                pool.shutdown(cancel_futures=True)
                break
    print(f"done: {len(todo)} plans, {changed} with changed exits, {failed} failed (run again); "
          f"spent {spent:.4f} USD", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
