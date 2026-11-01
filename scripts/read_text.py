"""Read the words on gallery plans with Muse Spark and add them to the items.

Usage:
  uv run --env-file .env python scripts/read_text.py GALLERY_DIR [--ids ID ...] [--workers 3] [--again]

For each plan, one call (reader.read_text, the call that runs beside the main
call for a new photo) reads the plan's language, title, legend and
instructions. The script writes them to items/<id>.json as "plan_text", the
form that a photo answer has, and the server sends them with the plan. It
skips a plan that has its words, unless --again. A failed read leaves the item
as it was. Every call goes through the spend ledger (HEREOUT_LEDGER).

The new items change the key of the saved answers: run scripts/save_answers.py
after this script.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2

from hereout.reader import ModelClient, ModelError, SpendCapReached


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("gallery", type=Path)
    ap.add_argument("--ids", nargs="*", help="only these plans")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--again", action="store_true", help="read plans that have their words again")
    args = ap.parse_args()
    client = ModelClient.from_env()
    if client is None:
        raise SystemExit("BASETEN is not set")
    items = sorted((args.gallery / "items").glob("*.json"))
    if args.ids:
        items = [p for p in items if p.stem in set(args.ids)]
    todo = [p for p in items if args.again or "plan_text" not in json.loads(p.read_text())]
    print(f"{len(items)} plans, {len(todo)} to read", flush=True)
    spent = 0.0

    def read(path: Path) -> tuple[str, str, float]:
        image = cv2.imread(str(args.gallery / "plans" / f"{path.stem}.jpg"), cv2.IMREAD_COLOR)
        if image is None:
            return path.stem, "no plan image", 0.0
        t = time.monotonic()
        try:
            words, cost = client.read_text(image)
        except (ModelError, SpendCapReached) as e:
            return path.stem, f"failed: {e}", 0.0
        item = json.loads(path.read_text())
        item["plan_text"] = words
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(item, ensure_ascii=False))
        os.replace(tmp, path)
        n = len(words["legend"]) + len(words["instructions"])
        return path.stem, f"{words['language'] or '?'}, {n} items, {time.monotonic() - t:.1f} s, {cost:.4f} USD", cost

    with ThreadPoolExecutor(args.workers) as pool:
        for i, (pid, note, cost) in enumerate(pool.map(read, todo), 1):
            spent += cost
            print(f"{i}/{len(todo)} {pid}: {note}", flush=True)
    print(f"spent {spent:.4f} USD", flush=True)


if __name__ == "__main__":
    main()
