"""Summarize a run of scripts/run_set.py and draw contact sheets for a visual check.

Usage: uv run python scripts/summarize_set.py OUT_DIR [--sheets N]
Writes OUT_DIR/summary.json and, with --sheets, OUT_DIR/sheets/sheet-<k>.jpg
(12 results each: flat plan, walls in blue, marks, route).
"""

import argparse
import collections
import json
import statistics
from pathlib import Path

import cv2
import numpy as np

from hereout.gallery import Gallery


def overlay(plan, reading) -> np.ndarray:
    img = plan.image.copy()
    img[plan.walls] = (img[plan.walls] * 0.5 + np.array([120, 0, 0])).astype("uint8")
    unit = max(img.shape[:2]) / 160
    for e in reading.exits:
        c = (int(e["x"]), int(e["y"]))
        cv2.rectangle(img, (c[0] - int(unit * 2), c[1] - int(unit * 2)), (c[0] + int(unit * 2), c[1] + int(unit * 2)), (0, 140, 0), -1)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--sheets", type=int, default=0)
    args = ap.parse_args()
    out = Path(args.out)
    items = [json.loads(p.read_text()) for p in sorted((out / "items").glob("*.json"))]

    outcome = collections.Counter()
    for i in items:
        if i["error"]:
            outcome["model error: " + i["error"]] += 1
        elif i["route_found"]:
            outcome["route"] += 1
        else:
            outcome[i["route_error"] or "no route"] += 1
    costs = [i["cost_usd"] for i in items if i.get("cost_usd")]
    secs = [i["seconds"] for i in items if not i["error"]]
    by_country = collections.defaultdict(lambda: [0, 0])
    for i in items:
        by_country[i["country"]][1] += 1
        by_country[i["country"]][0] += i["route_found"]
    summary = {
        "photos": len(items),
        "countries": len(by_country),
        "outcome": dict(outcome.most_common()),
        "cost_usd": {"total": round(sum(costs), 3), "median": round(statistics.median(costs), 4),
                     "max": round(max(costs), 4)} if costs else None,
        "seconds": {"median": statistics.median(secs), "p90": sorted(secs)[int(len(secs) * 0.9)],
                    "max": max(secs)} if secs else None,
        "by_country": {k: f"{v[0]}/{v[1]}" for k, v in sorted(by_country.items())},
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))

    if args.sheets:
        g = Gallery(out)
        ids = list(g.items)
        rng = np.random.default_rng(7)
        pick = [ids[k] for k in rng.choice(len(ids), size=min(len(ids), 12 * args.sheets), replace=False)]
        (out / "sheets").mkdir(exist_ok=True)
        for k in range(0, len(pick), 12):
            tiles = []
            for pid in pick[k:k + 12]:
                plan, reading, _ = g.open(pid)
                t = overlay(plan, reading)
                t = cv2.resize(t, (400, 300), interpolation=cv2.INTER_AREA)
                cv2.putText(t, pid, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
                cv2.putText(t, pid, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
                tiles.append(t)
            while len(tiles) % 3:
                tiles.append(np.full_like(tiles[0], 255))
            rows = [np.hstack(tiles[r:r + 3]) for r in range(0, len(tiles), 3)]
            cv2.imwrite(str(out / "sheets" / f"sheet-{k // 12}.jpg"), np.vstack(rows))


if __name__ == "__main__":
    main()
