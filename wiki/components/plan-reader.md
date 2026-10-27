---
type: component
title: Plan reader
updated: 2026-10-27
sources:
  - src/hereout/plan.py
  - src/hereout/walls.py
  - src/hereout/route.py
  - src/hereout/steps.py
  - src/hereout/reader.py
  - src/hereout/pipeline.py
  - src/hereout/app.py
  - src/hereout/web/route.js
---
# Plan reader

## Purpose

The plan reader changes a photo of a posted evacuation plan into a route and spoken steps. The user is a person who stands in front of the plan and must find the nearest exit.

## Behavior

| Stage | File | What it does |
|---|---|---|
| Flatten | `plan.py` | Finds the four corners of the plan sheet and warps the photo so that the sheet is square to the view. It keeps all of the photo. It does not cut the photo to the sheet. |
| Read | `reader.py` | Muse Spark gives the box of the floor drawing, the "you are here" point and the final exits. A second call on a zoomed crop makes the "you are here" point more accurate. |
| Walls | `walls.py` | Ink that is darker than the paper becomes wall. Strokes that are much thinner than the usual wall stroke are removed, because they are door swings and text. Thick faint ink is removed, because it is a painted route band. All of the page outside the floor box is wall. |
| Route | `route.py`, `web/route.js` | On a grid of 320 cells on the long side, Dijkstra from all exits gives the escape field: the cost to the nearest exit for each open cell. Cells near a wall cost more, so the route stays in the middle of corridors. The browser finds the field and the routes. |
| Steps | `steps.py`, `web/route.js` | The route becomes a list of turns and walks. |
| Web | `app.py`, `web/` | The user uploads a photo and sees the escape map and the route on the flat plan. A tap on an open spot gives the route from that spot. When the exits are wrong, the user marks the exit. |

- Walls can be black or one color. When most of the ink in the floor box has one hue, that hue is the wall color. The model does not give the wall color: in the first tests it gave black for red walls.
- The first step names a side of the plan, for example "toward the top of the plan". It does not name a side of the body, because some posted plans do not show "up" as the direction that the reader faces. Each later step is a turn from the step before it.
- The steps give no distance in meters. The photo has no reliable scale. A walk is "short", "medium" or "long" in comparison with the size of the plan.
- When the sheet is at an angle, the aspect ratio of the sheet comes from a pinhole camera model. When the focal length cannot be solved, the code uses the focal length of a typical phone camera.
- The server keeps no photo after it answers. It writes no photo to disk. Why: [Find the routes in the browser](../decisions/browser-routing.md).
- Each address can send 12 photos to the model in 10 minutes. After that, the user marks the plan by hand.
- The user can set the start or the exit with a pointer or with the keyboard (arrow keys, Enter, Escape). When the model finds more than one exit, a numbered button for each other exit gives the route to that exit.
- The escape map shows the cost to the nearest exit as a colour: green near an exit, yellow far from one. Lines show the ways that many routes share. A spot with no colour has no open way in the wall grid.
- Soft route bands: a first rule also removed thin faint lines. It opened the blocked rooms of one test plan, but it also cut thin walls with gaps. So only thick faint ink is removed now.
- The page keeps the last answer in the session storage of the browser, so a reload shows it again.
- Reviews before the first release: UX, accessibility (WCAG 2.2 AA) and copy. Their entries are in the hub `review-ledger/`.

## Known limits

- On the test plan PT-commons_000107, the exit signs stand in the doorways, so the wall grid closes those doors. The model also put the exits on the street side about 90 pixels outside the outer line of the building. So the routes in the hall go to the exits at the top, and the left wing has no open way.

## Related

- [Find the routes in the browser](../decisions/browser-routing.md)
- [Read plans with Muse Spark through Baseten](../decisions/model-provider.md)
