---
type: log
title: Wiki log
updated: 2026-10-27
---
# Wiki log

Add one entry for each operation. Put the newest entry at the bottom.

## [2026-10-26] init | Wiki created

- Created `index.md`, `log.md`, `glossary.md` and `config.json`.

## [2026-10-27] ingest | Plan reader and model provider

- Added `components/plan-reader.md` and `decisions/model-provider.md`.
- Source: the first version of `src/hereout/` and the first test with six plan photos.

## [2026-10-27] ingest | First step names a side of the plan

- Updated `components/plan-reader.md`: the first step names a side of the plan, not a side of the body.
- Source: the copy review of the step texts.

## [2026-10-27] ingest | Web demo after the first reviews

- Updated `components/plan-reader.md`: keyboard marks, buttons for other exits, session storage, time limit that starts again.
- Source: the UX, accessibility and copy reviews of the web demo.

## [2026-10-27] ingest | Sample gallery

- Added `components/gallery.md`.
- Source: `scripts/run_set.py`, `src/hereout/gallery.py` and the first batch run on the open-licensed photo set.

## [2026-10-27] ingest | Gallery after the first full run and the reviews

- Updated `components/gallery.md`: credit details, gallery ids, sample address, the sheet check, the results of the first run.
- Source: the run on 203 photos and the ux, a11y and copy reviews.

## [2026-10-27] ingest | Low reasoning effort

- Updated `decisions/model-provider.md`: both model calls use low reasoning effort, with the test on 30 plans.
- Source: the owner request about time and cost, and the test.

## [2026-10-27] ingest | Escape map and routes in the browser

- Added `decisions/browser-routing.md`.
- Updated `components/plan-reader.md` (escape field, map, thick faint ink, known limits) and `components/gallery.md` (no server state, route results found again).
- Source: the owner request for all ways to the exits, the parity test and the check on PT-commons_000107.

## [2026-10-27] ingest | Routes only view

- Updated `decisions/browser-routing.md`: the "Routes only" view, with the walls of the routing grid in grey.
- Source: the owner request to see the routes without the photo.

## [2026-10-27] ingest | Ways out as straight centre lines

- Added `decisions/way-network.md`. Linked it from `index.md` and `decisions/browser-routing.md`.
- Source: the owner request of 2026-10-27, the research of methods, and the network in `src/hereout/web/route.js`.
- Recorded the review fixes: shortcut from the start, no legs with almost no flow, opaque lines, status before an exit route.

## [2026-10-27] ingest | Wall lines and a door-to-door network

- Added `decisions/wall-lines.md`. Rewrote `decisions/way-network.md` for the door-to-door network. Updated `index.md` and `decisions/browser-routing.md`.
- Source: the owner request of 2026-10-27, `src/hereout/wall_lines.py` and the network in `src/hereout/web/route.js`.
- Recorded the review fixes: a door at each opening, taps that look two rooms away, trunk lines, lighter walls and wider ways.

## [2026-10-27] ingest | Doors over blank paper, stairs, bent walls

- Updated `decisions/wall-lines.md`: joins and line ends only over ink, stair treads are not walls, one line for a wavy wall of one thin stroke. The PT hall walls still give no line.
- Source: the owner request of 2026-10-27 and `src/hereout/wall_lines.py`.

## [2026-10-27] ingest | Known problems, recorded only

- Updated `components/plan-reader.md`: Known limits lists the open problems after the wall-line and door-to-door changes. The old item about exit signs in the doorways is gone, because symbols are no longer walls.
- Source: the owner request of 2026-10-27 (record only, no fix now) and the ux reviews of 2026-10-27.

## [2026-10-27] ingest | Fixes with no model call

- Updated `components/plan-reader.md`: no clear disc for exit marks, a free place for the "YOU" label, the network worker, and the known limits after the fixes.
- Updated `decisions/wall-lines.md`: the colour rule for printed routes, and why HSV saturation did not work.
- Updated `decisions/way-network.md`: the network comes from a Web Worker.
- Source: the owner request of 2026-10-27 (fix what needs no model call), `src/hereout/wall_lines.py`, `src/hereout/web/route.js`, `src/hereout/web/network-worker.js`, `src/hereout/web/app.js` and the gallery route check.

## [2026-10-28] ingest | Exit check with numbered marks

- Added `decisions/exit-mark-check.md`: research on coordinate formats, the failed local candidates, and the 30-plan test of a second call with numbered marks.
- Updated `components/plan-reader.md`: the PT exit limit links the test.
- Source: the owner requests of 2026-10-27 and 2026-10-28, and the test outputs.

## [2026-10-28] ingest | Read prompt in the Meta style, clamp on the grid

- Updated `decisions/exit-mark-check.md`: the Meta grounding rules, the 5-plan pilot of a one-call prompt, the square-image check, and the clamp.
- Source: the owner request of 2026-10-28, the Meta image understanding page, `src/hereout/reader.py`.

## [2026-10-28] ingest | Review pages at /review/

- Updated `components/plan-reader.md`: the server shows the gallery `review/` folder at `/review/`.
- Source: the owner request of 2026-10-28 (check the samples on the subdomain), `src/hereout/app.py`.

## [2026-10-28] ingest | Country hints test

- Updated `decisions/exit-mark-check.md`: the 20-call test of one prompt for all countries against one prompt for each country.
- Source: the owner request of 2026-10-28 and the test outputs.

## [2026-10-28] ingest | New read prompt in the product

- Updated `decisions/exit-mark-check.md`: the first call uses the Meta-style prompt with the floor rule.
- Source: the owner approval of 2026-10-28, `src/hereout/reader.py`.

## [2026-10-28] ingest | Zoom on suspect exits

- Updated `decisions/exit-mark-check.md`: ideas from similar work, the Baseten image limit, and the 6-plan test of a gated zoom.
- Source: the owner request of 2026-10-28, the Sensors 2023 paper, the DiMo-GUI paper, the test outputs.

## [2026-10-28] ingest | Exit zoom in the product, review set

- Updated `decisions/exit-mark-check.md`: the zoom is a separate call at the same time as the "you are here" zoom, with its numbers.
- Updated `components/plan-reader.md`: the two second looks and the review set.
- Source: the owner request of 2026-10-28, `src/hereout/reader.py`, `src/hereout/app.py`, `src/hereout/web/app.js`.

## [2026-10-28] ingest | Exits of every level, open problems

- Updated `decisions/exit-mark-check.md`: the owner check of the review set and the test of the rule for every level (branch `exit-level-rule`).
- Updated `components/plan-reader.md`: the known limits after the exit zoom.
- Source: the owner check of 2026-10-28 and the test outputs.

## [2026-10-28] ingest | Start from a tap, exits of every level on main

- Created `decisions/start-from-tap.md`: the model gives no start, and the gallery check has no start.
- Updated `components/plan-reader.md`: the read stage and the second call.
- Updated `decisions/exit-mark-check.md`: the rule for every level is on main.
- Source: the owner words of 2026-10-28, `src/hereout/reader.py`, `src/hereout/web/app.js`, `scripts/run_set.py`.

## [2026-10-28] ingest | Printed route marks rejected

- Created `decisions/printed-route-marks.md`: the owner found no plan better, and the lines crossed walls before and after.
- Source: the owner check of 2026-10-28, branch `route-marks`, the crossed-line count on the 7 review plans.

## [2026-10-28] ingest | Walls from all drawn ink (test)

- Created `decisions/ink-walls.md`: the test, the 7-plan check and the gallery count.
- Source: the owner request of 2026-10-28, local branch `ink-walls`, the scratchpad evaluation.

## [2026-10-28] ingest | Plan parsing methods to test

- Created `concepts/plan-parsing-methods.md`: the research summary and the test order.
- Source: the owner request of 2026-10-28, the hub folder `docs/hereout-plan-parsing-2026-10-28/`.

## [2026-10-28] ingest | Wall method tests

- Created `decisions/wall-method-tests.md`: the ground truth, the scores and the result of each method.
- Source: the owner request of 2026-10-28, the test scripts of the session.

## [2026-10-28] ingest | Wall method tests: dashes, look at the best set

- Updated `decisions/wall-method-tests.md`: method 2 does not go on; a look at the ways out of the best set.
- Source: the test scripts of the session.

## [2026-10-28] ingest | Best wall set and blind A/B page

- Updated `decisions/wall-method-tests.md`: the best set on the branch, the gallery numbers and the A/B page.
- Source: branch `ink-walls`, the gallery check, the A/B page.

## [2026-10-29] ingest | Level and upright way lines

- Created `decisions/orthogonal-way-tree.md`: the owner verdict on the A/B page and the new tree of lines on branch `ortho-net`.
- Updated `decisions/wall-method-tests.md`: the owner verdict on the A/B page.
- Source: the owner words of 2026-10-29, commit 6920028.

## [2026-10-29] ingest | Way lines, second round

- Updated `decisions/orthogonal-way-tree.md`: the second round of refinement (commit 828f6e4) and its numbers.
- Source: the owner words of 2026-10-29, commit 828f6e4.

## [2026-10-29] ingest | Way lines, third round: outside areas, exit placement, room doors, wing

- Created `decisions/outside-and-closed-rooms.md`: grey fills, areas beyond the exits and at the edge, exit placement, room doors.
- Updated `decisions/orthogonal-way-tree.md`: third round (wing network, long staircases only, the worker gets the axes).
- Updated `index.md`.
- Source: the owner words of 2026-10-29, commit 78dcaca on `ortho-net`, the ground truth and the 38-plan comparison.

