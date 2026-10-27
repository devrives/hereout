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
