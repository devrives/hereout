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
- Each gallery plan shows a credit line: title, author, licence, source link and the changes. The changes come from each photo: "perspective corrected" only when the photo was warped, "resized" only when the size changed, then "marks, escape map and route drawn on top".
- For a CC BY-SA photo, the credit says that the changed image is shared under the same licence.
- A "Photo credits" list under the gallery gives the credit of every preview.
- A gallery plan has the id `g-<photo id>`. The browser finds every route from the grid in the answer, so the plan needs no server state.
- The address `?sample=<photo id>` opens that plan, so a link can show one sample.
- The list puts plans with a route first. The countries take turns, so the first rows show many countries.
- `scripts/summarize_set.py` counts the results and draws contact sheets for a check by eye.
- A route that the reader finds is not always the correct route. The gallery text does not claim accuracy.
- `plan.py` rejects a sheet whose opposite sides differ much in length (ratio below 0.72). In the photo set, every false sheet had a ratio of 0.71 or less. `run_set.py --refresh` finds the saved results that a change of `plan.py` makes old, with no model call. It also finds the route again from each saved reading with the current wall and route code.

## First run

The first full run was on 2026-10-27:

| Item | Value |
|---|---|
| Photos | 203 (24 countries, and 2 photos with no known country) |
| Route found | 187 |
| No open way to an exit | 15 |
| No "you are here" mark | 1 |
| Model errors | 0 |
| Cost | 5.07 USD in total, median 0.023 USD for each photo |
| Time | median 24 s, 90th percentile 34.7 s, highest 58.7 s |

A check by eye of 24 random results found about 17 routes that look correct. The other routes start at a wrong point, stay in a small box, or are on a map that is not a floor plan.

## Related

- [Plan reader](plan-reader.md)
