"""Use the far zoom points of the saved gallery readings that now pass far_point_ok. No model call.

Usage:
  uv run python scripts/far_points.py GALLERY_DIR [--ids ID ...] [--dry-run]

Before reader.far_point_ok, the second look refused every zoom point farther
than ZOOM_MAX_MOVE from its first point ("too far"). The record of the check
(scripts/zoom_saved.py) keeps where the model pointed on its sheet ("seen").
The crops and sheets come again from the exits of the main reading in
"trace" (reader.seen_points), so each refused point comes back exactly, and
the rule of the live path decides again with no call.

For each plan with a "too far" point that passes, the script writes
items/<id>.json: the trace entry becomes "moved" (with "to" and "far"),
"exits" get the new point, and "route_found" and "open_with_way" are found
again, as zoom_saved.py does. A plan whose saved exits do not follow from
its trace is left as it is. The sheets do not change. Run it again: a moved
point is not "too far", so nothing changes twice. After the run, the saved
answers are old: run scripts/save_answers.py on the same folder.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).parent))
from zoom_saved import route_of  # noqa: E402

from hereout.reader import far_point_ok, mark_distance, seen_points  # noqa: E402


def exits_of(trace: list[dict], saved: list[dict]) -> list[dict] | None:
    """The exits after the check, from its trace: each exit that the check did
    not drop, at its new point. The other keys come from the saved exits. None
    when the trace does not give the saved points."""
    kept = [t for t in trace if t.get("zoom") != "dropped"]
    if len(kept) != len(saved):
        return None
    out = []
    for t, e in zip(kept, saved):
        x, y = t["to"] if t.get("zoom") == "moved" else (t["x"], t["y"])
        out.append({**e, "x": x, "y": y})
    return out


def same_points(a: list[dict], b: list[dict]) -> bool:
    return all(abs(p["x"] - q["x"]) < 0.01 and abs(p["y"] - q["y"]) < 0.01 for p, q in zip(a, b)) and len(a) == len(b)


def far_one(folder: Path, item: dict, write: bool) -> dict | None:
    """Apply the rule to one item. Returns a summary when a point changes, else None."""
    r = item["reading"]
    trace = r.get("trace") or []
    refused = [t for t in trace if t.get("why") == "too far" and t.get("seen")]
    if r.get("zoom") != "done" or not refused:
        return None
    pid = item["id"]
    again = exits_of(trace, r["exits"])
    if again is None or not same_points(again, r["exits"]):
        print(f"{pid}: saved exits do not follow from the trace; left as it is", file=sys.stderr)
        return None
    image = cv2.imread(str(folder / "plans" / f"{pid}.jpg"), cv2.IMREAD_COLOR)
    first = [{"x": t["x"], "y": t["y"]} for t in trace]
    crops = {t["crop"]: i for i, t in enumerate(trace) if t.get("crop")}
    suspects = [crops[n] for n in sorted(crops)]
    points = seen_points(image.shape, first, suspects, {t["crop"]: tuple(t["seen"]) for t in refused})
    dist = mark_distance(image)
    box = tuple(r["plan_box"]) if r.get("plan_box") else None
    moved = []
    new_trace = [dict(t) for t in trace]
    for i, t in enumerate(trace):
        if any(t is u for u in refused) and far_point_ok(dist, *points[t["crop"]], box):
            x, y = points[t["crop"]]
            new_trace[i] = {k: v for k, v in t.items() if k not in ("zoom", "why")}
            new_trace[i].update(zoom="moved", to=[x, y], far=True)
            moved.append({"crop": t["crop"], "from": [round(t["x"]), round(t["y"])], "to": [round(x), round(y)]})
    if not moved:
        return None
    exits = exits_of(new_trace, r["exits"])
    summary = {"id": pid, "moved": moved, "refused": len(refused) - len(moved)}
    if not write:
        return summary
    after = route_of(folder, item, image, exits)
    summary.update(before={k: item.get(k) for k in ("route_found", "open_with_way")},
                   after={k: after[k] for k in ("route_found", "open_with_way")})
    item.update(after)
    r.update(exits=exits, trace=new_trace)
    path = folder / "items" / f"{pid}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(item, ensure_ascii=False))
    os.replace(tmp, path)
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gallery", type=Path)
    ap.add_argument("--ids", nargs="*", default=None, help="only these plans")
    ap.add_argument("--dry-run", action="store_true", help="list the changes; write nothing")
    args = ap.parse_args()
    changed = points = 0
    for p in sorted((args.gallery / "items").glob("*.json")):
        item = json.loads(p.read_text())
        if not item.get("reading") or (args.ids is not None and item["id"] not in args.ids):
            continue
        s = far_one(args.gallery, item, not args.dry_run)
        if s is None:
            continue
        changed += 1
        points += len(s["moved"])
        line = f"{s['id']}: " + ", ".join(f"crop {m['crop']} {m['from']} -> {m['to']}" for m in s["moved"])
        if s["refused"]:
            line += f" ({s['refused']} still refused)"
        if "after" in s:
            line += f" | route {s['before']} -> {s['after']}"
        print(line, flush=True)
    print(f"{'would change' if args.dry_run else 'changed'}: {points} points on {changed} plans")
    return 0


if __name__ == "__main__":
    sys.exit(main())
