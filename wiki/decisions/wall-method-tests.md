---
type: decision
title: Test the wall methods on a small ground truth
status: proposed
updated: 2026-10-28
checked: 8a41f46
sources:
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

- The best set is methods 1, 3, 4 and 5. It is on no branch yet: the test code is in the session scratchpad.
- The footprint test without edge ink failed: the outer wall of many plans touches the box of the model, so the floor went away.
- NO-openverse_000112 still has 4 of 7 rooms with no way out. Many false circles come from symbols, and the outside fill closes part of the balcony.
- JP-commons_000365 still has a leak of 1.0: the frame of the sign joins the two levels into one footprint.
