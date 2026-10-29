---
type: decision
title: Test the wall methods on a small ground truth
status: proposed
updated: 2026-10-29
checked: 8a41f46
sources:
  - owner:2026-10-29
  - owner:2026-10-28
---
# Test the wall methods on a small ground truth

## Context

- The count of crossed drawn lines did not agree with a look by eye. Why: [Take the walls from all drawn ink](ink-walls.md).
- The owner asked to test all methods with no model call, and to record each result (2026-10-28). The methods: [Plan parsing methods to test](../concepts/plan-parsing-methods.md).

## Decision

- A small ground truth on the 7 review plans gives three scores. The file is `review/ground-truth.json` in the gallery folder, outside the repository, because it belongs to the plan photos.
  - Floor: the share of 55 floor points that have a way to an exit. Higher is better.
  - Leak: the share of 38 points off the floor (paper, legend, the gap between levels) that have a way to an exit. Lower is better.
  - Walls: the share of 9 point pairs on two sides of a wall whose way is at least two times the straight line. Higher is better.
- A method goes on only when no score gets worse.

## Consequences

Scores on 2026-10-28 (floor, leak, walls):

| Walls | Floor | Leak | Walls |
|---|---|---|---|
| Wall lines (main) | 0.852 | 0.628 | 0.806 |
| All drawn ink and wall lines | 0.852 | 0.371 | 0.806 |
| Ink only, no wall lines | 0.878 | 0.389 | 0.639 |
| Thick strokes by reconstruction; a thin line is a wall only when it touches walls at two places (method 1) | 0.878 | 0.389 | 0.694 |
| Method 1 and a filled footprint for each drawing (methods 3 and 4) | 0.878 | 0.273 | 0.861 |
| The same, and door arcs cut into openings (method 5) | 0.918 | 0.273 | 0.861 |
| Footprints without ink that touches the box edge | 0.427 | 0.000 | 0.917 |
| Best set, and dashed lines made open (method 2) | 0.901 | 0.273 | 0.861 |

- The best set is methods 1, 3, 4 and 5. It is on no branch yet: the test code is in the session scratchpad.
- The footprint test without edge ink failed: the outer wall of many plans touches the box of the model, so the floor went away.
- NO-openverse_000112 still has 4 of 7 rooms with no way out. Many false circles come from symbols, and the outside fill closes part of the balcony.
- JP-commons_000365 still has a leak of 1.0: the frame of the sign joins the two levels into one footprint.
- Method 2 made FR-web_more_000045 worse (one floor point lost) and helped no plan. It does not go on.
- A look at the ways out of the best set, against main: RU-commons_000169 and FR-web_more_000045 are better, with ways inside the building and the floors. JP-commons_000369 lost almost all ways. PT-commons_000107 has more short lines in the wings and lines above the building. Exits 3 to 5 of RU-commons_000169 have no line now.

## Best set on the branch

- The branch `ink-walls` holds the best set in `ink_walls.py` and the legend check in `legend.py`. More rules came from the gallery check:
  - Bridges close a wall gap when the two wall ends face each other.
  - The paper around each exit stays open, and each exit gets a narrow cut to the nearest large open area.
  - A door arc needs its hinge on a wall and a drawn leaf.
  - A wall drawn as two thin lines is closed.
- On the ground truth: floor 0.918, leak 0.319, walls 0.861 (main: 0.852, 0.628, 0.806).
- On the 203 gallery plans:
  - Crossed drawn lines went from 11.8 to 7.4 for each 1000 px (median).
  - Plans with no line went from 7 to 3.
  - Plans with less than half of the open space linked to an exit went from 5 to 17.
- The legend check found a legend box on 78 plans. It dropped 6 exits, and all 6 were in a legend or a text panel (look by eye).
- A look by eye found mixed results: DE-commons_000155 and US-openverse_000109 are better, RU-commons_000346 lost lines, and PT-commons_000107 is not clean.
- The owner gets a blind A/B page of 14 plans at `/review/` (2026-10-28). The key is `ab-key-2026-10-28.json` in the experiments folder of the hub workspace. A method that the owner does not choose does not go to main.
- The owner verdict on the A/B page (2026-10-29): both sides are bad. The lines have diagonals and do not join. Next: [Draw the ways out as one tree of level and upright lines](orthogonal-way-tree.md).
- The branch `route-marks` was deleted on 2026-10-28. Its commit 3d6310b stays in this page.
