---
type: decision
title: Fast processing of a new photo
status: accepted
updated: 2026-10-29
checked: 94ef873
sources:
  - owner:2026-10-29
  - src/hereout/pipeline.py
  - src/hereout/ink_walls.py
  - src/hereout/wall_lines.py
  - src/hereout/walls.py
  - tests/test_ink_walls.py
---
# Fast processing of a new photo

## Context

- On 2026-10-29 the owner asked for fast processing of any new photo, with optimization of all steps other than the model call.
- The server container has one CPU. A measurement in the container image with one CPU, on 14 photos from 14 countries, gave these mean times:

| Step | Time |
|---|---|
| Decode the photo | 0.05 s |
| Flatten the sheet | 0.11 s |
| Text boxes | 2.51 s |
| Wall pass before the model call | 5.81 s |
| Wall pass after the model call | 5.5 s |
| Answer (image and grid) | 0.31 s |

- All 14.4 s of this work was on the path of the request, in addition to the model call.
- The wall pass before the model call had no use when the model answered. The server found the walls again with the exits from the model.

## Decision

- `prepare` makes only the flat image. `read_marks` finds the walls one time: with the exits from the model, or with no exits when the model gives none.
- The model call waits on the network. `read_marks` finds the text boxes in a second thread during the call.
- Faster wall steps with the same output:
  - `_thin`: Zhang-Suen thinning that looks again only at the pixels whose neighbours changed. A test compares it with the plain method.
  - `gap_bridges`: the skeleton points near each wall end come from a window around the end. The test of the pairs of ends uses arrays.
  - `_grow` in `wall_lines.py`: a direct check of the pixels around each point, with the same rounding.
  - `_chroma` and `strong_ink` (the ink without faint fills, and the wall hue) run one time for each wall pass. Before, two steps made each of them.
- `door_arcs`: the RANSAC fit draws and scores all 60 tries of a branch at one time. The random draws are not the same as before, so some door cuts changed.

## Consequences

- The wall pass on one core of the host: 73.9 s before and 24.2 s after, for the same 14 plans.
- The check on all 203 gallery plans against the saved answers of the old code:
  - The exits are the same on all plans.
  - 96 wall grids changed, by a median of 10 cells (106 at most).
  - The mean share of open floor with a way out is 0.9319 before and 0.9318 after. The largest drop is JP-commons_000383, from 0.817 to 0.796.
- On JP-commons_000383 the new result stays the same with 60, 150 and 300 tries. The old result came from one set of random draws, so the number of tries stays at 60.
- Saved gallery answers have a key from the code, so the script `scripts/save_answers.py` must run again after the deploy (see [Sample gallery](../components/gallery.md)).
