"""Score the exits of a run of scripts/run_set.py against hand labels.

Usage:
  uv run python scripts/score_exits.py RUN_DIR LABELS.json [--out FILE] [--points final|model] [--overlays DIR]

RUN_DIR is the output folder of scripts/run_set.py (items/<id>.json, plans/<id>.jpg).
LABELS.json holds, for each photo, the final exits that a person (or an agent)
marked by hand in the frame of plans/<id>.jpg: "sure" and "unsure" points, a
coarse box of the floor drawing, and photos that cannot be judged. The labels
and the photos stay outside the repository; the README gives the format.

Points. "final" (the default) scores reading.exits: the exits after the code
dropped legend points and placed each exit on the drawing, which are the
exits the browser routes to. "model" scores the points that Muse Spark gave
(after the second look), from item["read"]; a run made before run_set.py
saved "read" has no such points, and the script stops with a message.

Matching. Each predicted exit can match one label and each label one predicted
exit (an optimal one-to-one assignment, the Hungarian method). A pair can match
only when the two points are within the radius R of each other. The assignment
first gets the most "sure" labels, then the most "unsure" labels, then the
shortest distances.

  - A matched "sure" label is a hit. An unmatched "sure" label is a miss.
  - An "unsure" label is optional: a prediction on it is neither a hit nor a
    false exit, and no prediction on it is not a miss.
  - A prediction that matches no label is a false exit.
  - "strict" counts every unsure label as a sure one.

Radius. R = max(SHARE * L, MIN_RADIUS_PX), with L the long side of the
floor box in the labels. The photos show plans at very different sizes
(the floor drawing is 270 to 1330 px wide in a 1600 px image), so a fixed
pixel radius would be loose on a large plan and strict on a small one. The
box comes from the labels, not from the model, so a wrong model box cannot
make the radius larger. SHARE is 0.05 by default: on these plans one door is
about 2 to 4 % of L, two neighbour doors can be 7 % of L apart, and the
one-to-one match keeps one point from taking both. MIN_RADIUS_PX (12 px)
covers the error of a hand-placed label on a small plan. The script also
reports the scores at half and at double SHARE, so a reader can see how much
the result depends on this choice.

Frame. The labels are points in plans/<id>.jpg as scripts/run_set.py saves it
(the flat plan from pipeline.prepare). A photo whose plan image in the run has
another size than in the labels is not scored and is listed as a frame mismatch.

Photo scores. "all right": every sure label is hit and there is no false exit.
"route": the run found a way out for most of the open floor (route_found in
the item, from run_set.py). Photos that the labels mark as unjudgeable are
left out of the exit scores and kept in the route share of all photos.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

SHARE = 0.05
MIN_RADIUS_PX = 12.0
SURE_WEIGHT = 1000.0   # a sure hit is worth more than any number of unsure hits
UNSURE_WEIGHT = 10.0


def hungarian(cost: list[list[float]]) -> list[int]:
    """Minimum-cost assignment for an n x m matrix with n <= m.
    Returns, for each row, the column it gets."""
    n, m = len(cost), len(cost[0]) if cost else 0
    if n == 0:
        return []
    if n > m:
        raise ValueError("more rows than columns")
    INF = float("inf")
    u, v = [0.0] * (n + 1), [0.0] * (m + 1)
    p, way = [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [INF] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], INF, 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    out = [0] * n
    for j in range(1, m + 1):
        if p[j]:
            out[p[j] - 1] = j - 1
    return out


def match(preds: list[tuple[float, float]], labels: list[dict], radius: float) -> dict[int, int]:
    """The one-to-one match of predictions to labels within the radius: {prediction index: label index}."""
    if not preds or not labels:
        return {}
    # Pad to a square matrix; a pad cell or a pair out of reach costs 0, which means "no match".
    n = max(len(preds), len(labels))
    cost = [[0.0] * n for _ in range(n)]
    for i, (px, py) in enumerate(preds):
        for j, lab in enumerate(labels):
            d = math.hypot(px - lab["x"], py - lab["y"])
            if d <= radius:
                w = SURE_WEIGHT if lab["confidence"] == "sure" else UNSURE_WEIGHT
                cost[i][j] = -(w + 1.0 - d / radius)  # every real match beats no match
    cols = hungarian(cost)
    return {i: j for i, j in enumerate(cols) if i < len(preds) and j < len(labels) and cost[i][j] < 0}


def radius_for(photo: dict, share: float) -> float:
    box = photo.get("plan_box")
    if box:
        long_side = max(box[2] - box[0], box[3] - box[1])
    else:
        long_side = max(photo["size"])
    return max(share * long_side, MIN_RADIUS_PX)


def predicted(item: dict | None, points: str) -> list[tuple[float, float]]:
    if not item or not item.get("reading"):
        return []
    if points == "final":
        return [(float(e["x"]), float(e["y"])) for e in item["reading"].get("exits") or []]
    read = item.get("read")
    if read is None:
        raise SystemExit(f"{item.get('id')}: no 'read' in the item; this run has no model points. Use --points final.")
    # Every exit of the model that the zoom check did not drop, at the point after the check.
    return [tuple(map(float, r.get("zoom_at") or r["at"])) for r in read["exits"] if r.get("zoom") != "dropped"]


def score_photo(photo: dict, preds: list[tuple[float, float]], share: float, strict: bool = False) -> dict:
    labels = [dict(e, confidence="sure") if strict else e for e in photo["exits"]]
    r = radius_for(photo, share)
    m = match(preds, labels, r)
    hit_labels = set(m.values())
    sure = [j for j, e in enumerate(labels) if e["confidence"] == "sure"]
    hits = [j for j in sure if j in hit_labels]
    misses = [labels[j]["n"] for j in sure if j not in hit_labels]
    on_unsure = [i for i, j in m.items() if labels[j]["confidence"] != "sure"]
    false = [i for i in range(len(preds)) if i not in m]
    return {"radius_px": round(r, 1), "sure": len(sure), "unsure": len(labels) - len(sure),
            "predicted": len(preds), "hits": len(hits), "misses": misses,
            "on_unsure": len(on_unsure),
            "false_exits": [[round(preds[i][0]), round(preds[i][1])] for i in false],
            "all_right": not misses and not false}


def ratio(a: int, b: int) -> float | None:
    return round(a / b, 3) if b else None


def score_run(items: dict[str, dict], labels: dict, share: float, points: str = "final", strict: bool = False) -> dict:
    photos = labels["photos"]
    per, hits = {}, [0, 0, 0]  # hits, sure labels, predictions that count (hits + false)
    all_right = judged = 0
    for pid, photo in sorted(photos.items()):
        item = items.get(pid)
        if not photo.get("judgeable", True):
            per[pid] = {"judgeable": False}
            continue
        if item and item.get("size") and list(item["size"]) != list(photo["size"]):
            # The flat plan of this run is not the image the labels were set on
            # (prepare() changed): the points cannot be compared.
            per[pid] = {"judgeable": True, "frame_mismatch": [item["size"], photo["size"]]}
            continue
        judged += 1
        s = score_photo(photo, predicted(item, points), share, strict)
        s["run"] = item is not None
        s["error"] = (item or {}).get("error")
        per[pid] = s
        hits[0] += s["hits"]
        hits[1] += s["sure"]
        hits[2] += s["hits"] + len(s["false_exits"])
        all_right += s["all_right"]
    return {"share": share, "strict": strict, "points": points,
            "exit_precision": ratio(hits[0], hits[2]), "exit_recall": ratio(hits[0], hits[1]),
            "hits": hits[0], "sure_labels": hits[1], "false_exits": hits[2] - hits[0],
            "photos_judged": judged, "photos_all_right": all_right,
            "share_all_right": ratio(all_right, judged), "photos": per}


def route_share(items: dict[str, dict], labels: dict) -> dict:
    photos = labels["photos"]
    judgeable = [p for p, v in photos.items() if v.get("judgeable", True)]
    found = lambda ids: sum(bool((items.get(p) or {}).get("route_found")) for p in ids)
    return {"all": {"photos": len(photos), "with_route": found(photos), "share": ratio(found(photos), len(photos))},
            "judgeable": {"photos": len(judgeable), "with_route": found(judgeable),
                          "share": ratio(found(judgeable), len(judgeable))}}


def load_items(run: Path) -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text()) for p in sorted((run / "items").glob("*.json"))}


def table(result: dict, routes: dict, items: dict[str, dict]) -> str:
    main = result["at"][str(SHARE)]
    lines = [f"points: {result['points']}   labels: {result['labels']}   run: {result['run']}", f"radius R = max(share * L, {MIN_RADIUS_PX:.0f} px), L = long side of the labelled floor box",
             "share   precision  recall  all-right photos     (strict: precision recall all-right)"]
    for key, r in result["at"].items():
        s = result["strict_at"][key]
        lines.append(f"{key:<7} {r['exit_precision']!s:<9}  {r['exit_recall']!s:<6}  "
                     f"{r['photos_all_right']}/{r['photos_judged']} = {r['share_all_right']!s:<6}"
                     f"   ({s['exit_precision']} {s['exit_recall']} {s['photos_all_right']}/{s['photos_judged']})")
    lines += ["", f"route found: {routes['all']['with_route']}/{routes['all']['photos']} photos "
                  f"({routes['judgeable']['with_route']}/{routes['judgeable']['photos']} judgeable)", "",
              f"per photo at share {SHARE} (labels: sure+unsure; misses = label numbers; false = predicted points)",
              f"{'photo':<20} {'R':>5} {'lab':>5} {'pred':>4} {'hit':>3}  route  misses / false exits"]
    for pid, s in main["photos"].items():
        if "frame_mismatch" in s:
            lines.append(f"{pid:<20} not scored: plan image size {s['frame_mismatch'][0]} differs from the labels {s['frame_mismatch'][1]}")
            continue
        if not s.get("judgeable", True):
            lines.append(f"{pid:<20} unjudgeable" + ("  route" if (items.get(pid) or {}).get("route_found") else ""))
            continue
        route = "yes" if (items.get(pid) or {}).get("route_found") else "no"
        note = f"  error: {s['error']}" if s["error"] else ("  not run" if not s["run"] else "")
        lines.append(f"{pid:<20} {s['radius_px']:>5} {s['sure']:>2}+{s['unsure']:<2} {s['predicted']:>4} {s['hits']:>3}  {route:<5}  "
                     f"{s['misses'] or '-'} / {s['false_exits'] or '-'}{note}")
    return "\n".join(lines)



def draw_overlays(run: Path, labels: dict, items: dict[str, dict], points: str, out: Path) -> None:
    """Labels as circles of radius R (green sure, orange unsure, with their number),
    predictions as crosses (blue hit, red false)."""
    import cv2

    out.mkdir(parents=True, exist_ok=True)
    for pid, photo in labels["photos"].items():
        img = cv2.imread(str(run / "plans" / f"{pid}.jpg"))
        if img is None:
            continue
        preds = predicted(items.get(pid), points)
        r = radius_for(photo, SHARE)
        m = match(preds, photo["exits"], r) if photo.get("judgeable", True) else {}
        for e in photo["exits"]:
            col = (0, 170, 0) if e["confidence"] == "sure" else (0, 140, 255)
            c = (int(e["x"]), int(e["y"]))
            cv2.circle(img, c, int(r), col, 2)
            cv2.putText(img, str(e["n"]), (c[0] + int(r) + 2, c[1]), 0, 0.8, col, 2)
        for i, (x, y) in enumerate(preds):
            col = (200, 80, 0) if i in m else (0, 0, 220)
            cv2.drawMarker(img, (int(x), int(y)), col, cv2.MARKER_CROSS, 22, 3)
        cv2.imwrite(str(out / f"{pid}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("run")
    ap.add_argument("labels")
    ap.add_argument("--out", help="JSON output (default RUN/score-<points>.json)")
    ap.add_argument("--points", choices=["final", "model"], default="final")
    ap.add_argument("--overlays", help="folder for one image per photo: labels, radius and predictions")
    args = ap.parse_args(argv)
    run, labels_path = Path(args.run), Path(args.labels)
    labels = json.loads(labels_path.read_text())
    items = load_items(run)
    shares = [SHARE / 2, SHARE, SHARE * 2]
    result = {"run": str(run), "labels": str(labels_path), "points": args.points,
              "radius": f"max(share * long side of the labelled floor box, {MIN_RADIUS_PX} px)",
              "at": {str(s): score_run(items, labels, s, args.points) for s in shares},
              "strict_at": {str(s): score_run(items, labels, s, args.points, strict=True) for s in shares},
              "route": route_share(items, labels)}
    missing = [p for p in labels["photos"] if p not in items]
    if missing:
        result["not_run"] = missing
    out = Path(args.out) if args.out else run / f"score-{args.points}.json"
    out.write_text(json.dumps(result, indent=1))
    print(table(result, result["route"], items))
    if missing:
        print(f"\nnot in the run ({len(missing)}): {', '.join(missing)}")
    print(f"\nwrote {out}")
    if args.overlays:
        draw_overlays(run, labels, items, args.points, Path(args.overlays))
        print(f"overlays in {args.overlays}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
