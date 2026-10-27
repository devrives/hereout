---
type: component
title: Sample gallery
updated: 2026-10-27
sources:
  - src/hereout/gallery.py
  - scripts/run_set.py
  - scripts/summarize_set.py
  - docker-compose.yml
---
# Sample gallery

## Purpose

The gallery lets a person without a plan nearby try HereOut on real posted plans. It also shows how the plan reader works on plans from many countries.

## Behavior

- The photos are open-licensed photos of posted evacuation plans. They come from Wikimedia Commons, Openverse and Flickr. Their index file gives the licence, the author and the source address of each photo.
- `scripts/run_set.py` runs the plan reader on each photo that is readable and not security-sensitive. It saves the flat plan, a small preview and the result (credit, model reading, route, cost, time).
- The output folder is `_workspace/hereout-gallery/` in the hub. It is not in this repository, because the photos belong to their authors.
- The server reads the folder from a read-only mount (`HEREOUT_GALLERY`). Opening a gallery plan uses the saved reading, so it makes no model call.
- Each gallery plan shows a credit line: title, author, licence, source link and the changes (resized, flattened, route drawn on top).
- The list puts plans with a route first. The countries take turns, so the first rows show many countries.
- `scripts/summarize_set.py` counts the results and draws contact sheets for a check by eye.
- A route that the reader finds is not always the correct route. The gallery text does not claim accuracy.

## Related

- [Plan reader](plan-reader.md)
