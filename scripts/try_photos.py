"""Run the full pipeline on photos and draw the result to out/.

Usage: uv run --env-file .env python scripts/try_photos.py [--cached] PHOTO [PHOTO ...]

--cached reuses the last model reading in out/<photo>.reading.json, so wall
changes can be checked without new model calls. The model gives no start, so
there is no route here: tap a start in the web page.
Photos stay outside the repository; out/ is gitignored.
"""

import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from hereout.pipeline import decode_photo, prepare, read_marks
from hereout.reader import ModelClient, Reading

OUT = Path("out")


def draw(plan, reading, path):
    img = plan.image.copy()
    walls = plan.walls
    img[walls] = (img[walls] * 0.4 + np.array([140, 0, 0])).astype("uint8")
    if reading:
        for e in reading.exits:
            cv2.circle(img, (int(e["x"]), int(e["y"])), 14, (0, 200, 0), -1)
    cv2.imwrite(str(path), img)


def main():
    args = sys.argv[1:]
    cached = "--cached" in args
    args = [a for a in args if a != "--cached"]
    client = None if cached else ModelClient.from_env()
    OUT.mkdir(exist_ok=True)
    for arg in args:
        name = Path(arg).stem
        plan = prepare(decode_photo(Path(arg).read_bytes()))
        saved = OUT / f"{name}.reading.json"
        t = time.monotonic()
        if cached:
            reading, err = Reading(**json.loads(saved.read_text())), None
            plan.use_reading(reading)
        else:
            reading, err = read_marks(plan, client)
            if reading:
                saved.write_text(json.dumps(reading.__dict__))
        took = time.monotonic() - t
        draw(plan, reading, OUT / f"{name}.jpg")
        print(json.dumps({
            "photo": name, "size": plan.image.shape[1::-1], "seconds": round(took, 1), "error": err,
            "exits": reading and [(round(e["x"]), round(e["y"]), e["label"]) for e in reading.exits],
            "cost_usd": reading and round(reading.cost_usd, 5),
            "plan_box": reading and reading.plan_box and [round(v) for v in reading.plan_box],
        }))
    if client:
        print("ledger", client.ledger.snapshot())


if __name__ == "__main__":
    main()
