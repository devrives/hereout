"""Several main reads of a plan and a vote on the exits: a test on the dev set.

Usage:
  uv run --env-file .env python scripts/vote_reads.py read DEV_DIR OUT_DIR [--k 3] [--temp 0] [--workers 4]
  uv run python scripts/vote_reads.py score DEV_DIR OUT_DIR [--tag t0]

read: K main calls of Muse Spark for each plan in DEV_DIR/plans (the main
call only, with the y fix of exit_fix; no second look, no text read). Each
answer goes to OUT_DIR/<tag>/<id>.<k>.json, with its cost. A file that is
already there is not read again, so a stopped run goes on where it stopped.
The calls go through the client of the server, so the spend cap of the local
ledger (HEREOUT_SPEND_CAP_USD) holds; a call that would pass it stops the run.

score: the exits of each single read and of a vote across the reads, scored
against DEV_DIR/labels.json with the rules of scripts/score_exits.py, at
2.5, 5 and 10 % of the labelled floor box.

The vote. The exits of the reads go into groups: a point joins the group of
another read's point within VOTE_SHARE of the long side of the model's floor
box, at most one point of each read in a group (a one-to-one match, as in the
score). A group with points from at least MIN of the K reads is an exit, at
the mean of its points. The floor box is the median of the boxes.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score_exits import match, ratio, score_photo  # noqa: E402

VOTE_SHARE = 0.04


def read(dev: Path, out: Path, k: int, temp: float, workers: int, tag: str) -> None:
    from hereout.reader import ModelClient, SpendCapReached

    client = ModelClient.from_env()
    if client is None:
        raise SystemExit("no BASETEN key in the environment")
    client.temperature = temp
    labels = json.loads((dev / "labels.json").read_text())["photos"]
    folder = out / tag
    folder.mkdir(parents=True, exist_ok=True)
    jobs = [(pid, i) for pid in sorted(labels) for i in range(k) if not (folder / f"{pid}.{i}.json").exists()]
    print(f"{len(jobs)} reads to make", flush=True)

    def one(job):
        pid, i = job
        img = cv2.imread(str(dev / "plans" / f"{pid}.jpg"))
        try:
            r = client.read_plan(img, refine=False)
        except SpendCapReached:
            return f"{pid}.{i}: spend cap reached"
        except Exception as e:  # a failed call is read again on the next run
            return f"{pid}.{i}: {type(e).__name__}: {e}"
        (folder / f"{pid}.{i}.json").write_text(json.dumps({
            "id": pid, "read": i, "temperature": temp, "cost_usd": r.cost_usd,
            "plan_box": r.plan_box, "exits": [{"x": e["x"], "y": e["y"], "label": e.get("label", "")} for e in r.exits],
        }))
        return f"{pid}.{i}: {len(r.exits)} exits, {r.cost_usd:.4f} USD"

    with ThreadPoolExecutor(workers) as pool:
        for line in pool.map(one, jobs):
            print(line, flush=True)
    print(json.dumps(client.ledger.snapshot()))


def vote(reads: list[dict], need: int) -> list[tuple[float, float]]:
    boxes = [r["plan_box"] for r in reads if r.get("plan_box")]
    box = [statistics.median(b[i] for b in boxes) for i in range(4)] if boxes else None
    long_side = max(box[2] - box[0], box[3] - box[1]) if box else 1000
    radius = VOTE_SHARE * long_side
    groups: list[list[tuple[float, float]]] = []
    for r in reads:
        pts = [(e["x"], e["y"]) for e in r["exits"]]
        centres = [{"x": statistics.mean(p[0] for p in g), "y": statistics.mean(p[1] for p in g), "confidence": "sure"}
                   for g in groups]
        m = match(pts, centres, radius)
        for i, p in enumerate(pts):
            if i in m:
                groups[m[i]].append(p)
            else:
                groups.append([p])
    return [(statistics.mean(p[0] for p in g), statistics.mean(p[1] for p in g)) for g in groups if len(g) >= need]


def totals(rows: list[dict]) -> dict:
    hits = sum(r["hits"] for r in rows)
    sure = sum(r["sure"] for r in rows)
    pred = sum(r["predicted"] - r["on_unsure"] for r in rows)
    return {"precision": ratio(hits, pred), "recall": ratio(hits, sure),
            "all_right": sum(r["all_right"] for r in rows), "photos": len(rows)}


def score(dev: Path, out: Path, tag: str) -> None:
    labels = {pid: p for pid, p in json.loads((dev / "labels.json").read_text())["photos"].items() if p.get("judgeable", True)}
    folder = out / tag
    reads: dict[str, list[dict]] = {}
    for f in sorted(folder.glob("*.json")):
        d = json.loads(f.read_text())
        reads.setdefault(d["id"], []).append(d)
    ids = [pid for pid in sorted(labels) if pid in reads]
    k = min(len(reads[pid]) for pid in ids)
    cost = sum(r["cost_usd"] for pid in ids for r in reads[pid])
    print(f"{tag}: {len(ids)} plans, {k} reads each, {cost:.3f} USD")
    print(f"{'set':<14}{'share':>6}{'P':>7}{'R':>7}{'all':>6}")
    for share in (0.025, 0.05, 0.1):
        for i in range(k):
            t = totals([score_photo(labels[pid], [(e["x"], e["y"]) for e in reads[pid][i]["exits"]], share) for pid in ids])
            print(f"{'read ' + str(i):<14}{share:>6}{t['precision']:>7}{t['recall']:>7}{t['all_right']:>6}")
        for need in range(1, k + 1):
            t = totals([score_photo(labels[pid], vote(reads[pid][:k], need), share) for pid in ids])
            print(f"{f'vote {need} of {k}':<14}{share:>6}{t['precision']:>7}{t['recall']:>7}{t['all_right']:>6}")
    # How much the reads differ: the share of exits of read 0 that read 1 has within the vote radius.
    same = []
    for pid in ids:
        a, b = reads[pid][0], reads[pid][1]
        if a["exits"]:
            box = a.get("plan_box") or [0, 0, 1000, 1000]
            r = VOTE_SHARE * max(box[2] - box[0], box[3] - box[1])
            m = match([(e["x"], e["y"]) for e in a["exits"]], [dict(e, confidence="sure") for e in b["exits"]], r)
            same.append(len(m) / max(len(a["exits"]), len(b["exits"])))
    print(f"read 0 and read 1 agree on {statistics.mean(same):.2f} of their exits (mean over plans)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["read", "score"])
    ap.add_argument("dev", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--temp", type=float, default=0.0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--tag", default=None)
    a = ap.parse_args()
    tag = a.tag or f"t{a.temp:g}"
    if a.mode == "read":
        read(a.dev, a.out, a.k, a.temp, a.workers, tag)
    else:
        score(a.dev, a.out, tag)


if __name__ == "__main__":
    main()
