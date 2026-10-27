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
---
# Plan reader

## Purpose

The plan reader changes a photo of a posted evacuation plan into a route and spoken steps. The user is a person who stands in front of the plan and must find the nearest exit.

## Behavior

| Stage | File | What it does |
|---|---|---|
| Flatten | `plan.py` | Finds the four corners of the plan sheet and warps the photo so that the sheet is square to the view. It keeps all of the photo. It does not cut the photo to the sheet. |
| Read | `reader.py` | Muse Spark gives the box of the floor drawing, the "you are here" point and the final exits. A second call on a zoomed crop makes the "you are here" point more accurate. |
| Walls | `walls.py` | Ink that is darker than the paper becomes wall. Strokes that are much thinner than the usual wall stroke are removed, because they are door swings and text. All of the page outside the floor box is wall. |
| Route | `route.py` | A* on a grid of 320 cells on the long side finds the route to the nearest exit. Cells near a wall cost more, so the route stays in the middle of corridors. |
| Steps | `steps.py` | The route becomes a list of turns and walks. |
| Web | `app.py`, `web/` | The user uploads a photo and sees the route on the flat plan. When the reading is wrong, the user taps the start and the exit, and the server finds a new route. |

- Walls can be black or one color. When most of the ink in the floor box has one hue, that hue is the wall color. The model does not give the wall color: in the first tests it gave black for red walls.
- The first step names a side of the plan, for example "toward the top of the plan". It does not name a side of the body, because some posted plans do not show "up" as the direction that the reader faces. Each later step is a turn from the step before it.
- The steps give no distance in meters. The photo has no reliable scale. A walk is "short", "medium" or "long" in comparison with the size of the plan.
- When the sheet is at an angle, the aspect ratio of the sheet comes from a pinhole camera model. When the focal length cannot be solved, the code uses the focal length of a typical phone camera.
- Photos stay in memory for 15 minutes so that the user can correct the marks. The server writes no photo to disk.
- Each address can send 12 photos to the model in 10 minutes. After that, the user marks the plan by hand.
- The 15-minute limit starts again each time the user asks for a new route.
- The user can place the marks with a pointer or with the keyboard (arrow keys, Enter, Escape). When the model finds more than one exit, a button for each other exit gives the route to that exit.
- The page keeps the last answer in the session storage of the browser, so a reload shows it again.
- Reviews before the first release: UX, accessibility (WCAG 2.2 AA) and copy. Their entries are in the hub `review-ledger/`.

## Related

- [Read plans with Muse Spark through Baseten](../decisions/model-provider.md)
