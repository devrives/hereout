"""Save the answer of each gallery plan ahead of time, so the server sends it at once.

Usage:
  uv run python scripts/save_answers.py GALLERY_DIR [--workers 3]

Finding the walls of a plan takes 5 to 11 s on the server's one CPU. This
script finds them for every plan and writes answers/<id>.<key>.json in the
gallery folder. The key is a hash of the server code, the item and the plan
image, so the server uses a saved answer only when nothing changed since. Run
it again after a change of src/hereout/ or of the gallery. It skips a plan
with a current answer and deletes answers for an old key. It makes no model
call.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from hereout.gallery import Gallery

gallery: Gallery | None = None


def load(folder: str) -> None:
    global gallery
    gallery = Gallery(Path(folder))


def save(pid: str) -> tuple[str, float]:
    t = time.monotonic()
    path = gallery.answer_path(pid)
    out = gallery.answer(pid)
    if out is None:
        return pid, -1.0
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, separators=(",", ":")))
    os.replace(tmp, path)
    return pid, time.monotonic() - t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("gallery", type=Path)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    load(str(args.gallery))
    folder = args.gallery / "answers"
    folder.mkdir(exist_ok=True)
    current = {gallery.answer_path(pid) for pid in gallery.items}
    for p in folder.glob("*.json"):
        if p not in current:
            p.unlink()
    todo = [pid for pid in gallery.items if not gallery.answer_path(pid).exists()]
    print(f"{len(gallery.items)} plans, {len(todo)} to save", flush=True)
    with ProcessPoolExecutor(args.workers, initializer=load, initargs=(str(args.gallery),)) as pool:
        for i, (pid, sec) in enumerate(pool.map(save, todo), 1):
            print(f"{i}/{len(todo)} {pid} " + (f"{sec:.1f} s" if sec >= 0 else "not opened"), flush=True)


if __name__ == "__main__":
    main()
