---
type: decision
title: Take the walls from all drawn ink
status: proposed
updated: 2026-10-28
checked: 8a41f46
sources:
  - owner:2026-10-28
---
# Take the walls from all drawn ink

## Context

- The ways out crossed walls on the photo. The wall lines miss many walls. Why: [Follow the printed escape routes](printed-route-marks.md).
- The owner asked for walls from the drawing with no model call, with text and symbols taken out, for example with OCR (2026-10-28).

## Decision

- Not on main. The local branch `ink-walls` holds the test.
- The test takes every dark line of the drawing. OCR text boxes (RapidOCR, detection only), coloured ink and specks are taken out.
- Thick strokes and long straight thin lines are hard walls. Other thin ink (door swings, dashes) is soft: a route can cross it at a cost.
- The open paper outside the building is blocked. An exit reaches the open cells on each side of the line that it is on.

## Consequences

- On the 7 review plans, RU-commons_000169 and FR-web_more_000045 got ways inside the building, along the corridors.
- On the station plans, PT-commons_000107 and NO-openverse_000112 the result is not good. The two levels of a station join, rail lines cut up the corridors, and door lines close the rooms of NO.
- On all 203 gallery plans, the count of crossed drawn lines did not change (median 11.8 and 11.7 for each 1000 px). The plans with less than half of the floor open to an exit went from 5 to 26.
- So the change does not go to the owner review. Rules on the ink alone do not fit the many kinds of plan drawings.
