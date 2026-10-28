---
type: decision
title: Take the start from a tap, not from the model
status: accepted
updated: 2026-10-28
checked: 03aa6f9
sources:
  - owner:2026-10-28
  - src/hereout/reader.py
  - src/hereout/web/app.js
  - scripts/run_set.py
  - products/hereout.yaml#what_it_is
---
# Take the start from a tap, not from the model

## Context

- Until 2026-10-28 the model gave the "you are here" point and the exits. A second call on a zoomed crop made the "you are here" point more accurate.
- On 2026-10-28 the owner checked the review set of 7 plans. The owner said that the start is not the job of the model. The job of the model is to find all exits.
- The owner also asked for the rule for every level on main. That rule gives the exits of all levels, so a start on one level is not necessary for the read.

## Decision

- The model gives only the box of the floor drawing and the final exits. The prompt has no "you are here" item.
- The zoomed call for "you are here" is removed. The zoom on suspect exits stays.
- A plan opens with no start. The page shows the exits and the escape map, and asks the user to tap where they stand.
- The rule for every level is on main. Why: [Check the exits with numbered marks](exit-mark-check.md).
- The gallery check has no start. It is the share of open floor in the floor box with a way to an exit. A plan passes at 50 percent or more.

## Consequences

- Each read costs one call less.
- On the 203 saved gallery readings, 196 plans pass the new check. The median share is 99.7 percent. With the old check, 191 plans had a route from "you are here".
- The new check does not find wrong lines. On JP-commons_000369 the walls of the grey corridors are not found, so almost all of the floor box is open and the plan passes.
- For a sample plan, the page asks for a tap on the plan's own "you are here" mark. The user does not stand in that building (ux review, 2026-10-28).
- The keyboard marker shows when the plan gets focus. After the arrow keys stop, a status line says where the marker is (a11y review, 2026-10-28).
- A tap on the plan's own "you are here" dot snaps to the nearest open cell. The dot clears no disc in the wall grid now.
- The registry fact changed with the deploy: [what_it_is](../../../products/hereout.yaml).
