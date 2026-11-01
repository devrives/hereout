---
type: decision
title: The second look on the gallery samples, with the crops the model saw
status: accepted
updated: 2026-11-01
checked: 73ef54e
sources:
  - owner:2026-11-01
  - src/hereout/reader.py
  - src/hereout/pipeline.py
  - src/hereout/app.py
  - src/hereout/web/reading.js
  - scripts/zoom_saved.py
  - scripts/run_set.py
---
# The second look on the gallery samples, with the crops the model saw

## Context

- The gallery readings are older than the zoom check ([Check the exits with numbered marks](exit-mark-check.md)). Each sample said that its reading had no zoom check.
- The second judge review (2026-11-01) said that judges open samples, so the second look was not visible to them.

## Decision

- The gated check moved from `read_plan` to `ModelClient.second_look`. A live photo and `scripts/zoom_saved.py` use the same gate, crops, sheets, prompt and rules.
- `zoom_saved.py` runs the check on the saved reading of each gallery plan. It writes the record into the item and the sheets to `zoom/<id>-<n>.<hash>.webp`. The server sends the sheets with a long cache.
- A plan with no suspect exit gets the record "none" with no call. A failed call writes nothing, so the next run tries again.
- The answer of a new photo carries the sheets as WebP data URLs, in memory only.
- The card "What Muse Spark read" shows each sheet as a small image. A dialog shows it large, with a ring where the model pointed. For each crop, the card says Moved, Kept, Dropped or No answer.
- `run_set.route_result` makes the walls with the exits, as the page does. Without them, exits on their doors closed most of the floor (HK-commons_000180: 3 % against 91 %).

## Consequences

- Test on 10 plans: 7 better, 1 slightly better, 1 with no clear change, 1 mixed (JP-commons_000369). `route_found` stayed true on all of them.
- The 7 % move limit refused correct points on PT-commons_000107 and SE-commons_000314. The card shows the refused points.
- Two runs on one plan gave different answers (SE-commons_000314).
- The saved readings hold exits after the legend and building fixes. Thus the gate on a sample starts from those exits, not from the raw model points.
- Dry run on the gallery: 142 of 203 plans have suspect exits, 389 exits on 175 sheets.
