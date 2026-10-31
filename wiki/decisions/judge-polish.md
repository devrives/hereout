---
type: decision
title: "Polish for the judging criteria: example, frame, tap checks, model reading"
status: accepted
updated: 2026-10-31
checked: 571f7f4
sources:
  - owner:2026-10-31
  - src/hereout/web/app.js
  - src/hereout/web/reading.js
  - src/hereout/web/route.js
  - src/hereout/web/index.html
  - src/hereout/gallery.py
  - src/hereout/gallery_order.json
  - src/hereout/pipeline.py
  - src/hereout/reader.py
  - scripts/example_marks.mjs
  - tests/test_tap.py
  - tests/test_model_reading.py
---
# Polish for the judging criteria: example, frame, tap checks, model reading

## Context

- On 2026-10-31 the owner asked for a check against the judging criteria of the hackathon. The criteria are Impact 30 %, Use of Meta AI Tooling 25 %, Technical Depth and Execution 20 % and Demo 25 %.
- A review agent took the role of a judge. It drove the live site on 15 gallery plans with 117 taps. Its score was 5.5 of 10.
- Its main points: the start page showed no result, and plans were small in the photo. Taps outside the plan gave routes, and the work of the model was not visible.
- The owner told the agent to do items 2 to 6 of the report with sub agents (2026-10-31). Items 7 (exit names, a paid new read) and 8 (SAM 3.1, it needs a Meta API key) wait for the owner.

## Decision

- Start page: a picture of a finished route on CN-commons_000098 (CC BY 4.0, not ShareAlike). The link opens that plan with the start of the picture.
- The repository keeps only the marks layer of the picture (`web/example-marks.webp`, made by `scripts/example_marks.mjs`). The server gives the saved gallery image under it. When the saved image does not match the code, the server removes the example.
- The start of the example is not in the address. A gallery plan and a shared link still open with no start ([Take the start from a tap](start-from-tap.md)).
- After the example opens, the status says "Example start, picked by hand" and tells the user to tap for another start. The ux review found that "the spot you chose" was not true there.
- The photo button comes before the example. On a phone of 667 px height, the example pushed the button to the edge of the screen.
- Gallery order: `gallery_order.json` gives the first plans and the last plans. The first plans had a route from 3 of 3 test taps, with routes in corridors and exits on exit marks. The last plans have a route to a closed stair, a route over a void, or routes round the outside.
- Frame: a plan opens on the box of the open cells of the wall grid. The frame also holds every exit and the start, with a margin of 5 %. The answer has no plan box, but every cell outside the box of the model is wall, so the two boxes are near.
- A box that covers 90 % of the photo on both sides shows all of the photo. "Photo only" keeps the frame, so the photo and the route compare at one place.
- Tap checks (`Field.tapStart` in `route.js`): a tap outside the box of the open floor gives no route and a message under the plan. A tap on wall or ink near open floor moves to the nearest open cell. The keyboard marker uses the same rules.
- Model reading: a card "What Muse Spark read" gives the floor box, each exit point with the label that the model wrote, and what occurred to the point. It also says that the walls and the routes come from code.
- A button draws the reading over all of the photo. In that view the other view buttons are off, and a tap, Enter or a view button only ends the view. The frame of the plan view is not the frame of the reading view, so a tap there must not set a start.
- `reader.py` keeps the result of the zoom check for each exit, and `pipeline.py` adds a `read` block to the answer. The gallery readings are older than the zoom check, so the gallery card says that its reading has no zoom check.
- `CLAUDE.md` said that SAM 3.1 marks parts of the plan. No code calls SAM, so the line now says that HereOut uses no other Meta model.

## Consequences

- Frame on the 203 gallery plans: 184 open on a frame, 11 on all of the photo, 8 have no open cells or are photo maps. The median width gain is 1.36 times, and 72 plans gain 1.5 times or more (TW-commons_000049: 4.85 times).
- Taps on 46 plans from 25 countries (2603 taps):

| Taps | Before | After |
|---|---|---|
| Open floor (920) | all route | all route |
| Near exit marks (378) | 377 route | 378 route |
| Closed areas (155) | all no way | all no way |
| Outside the box of the model (460) | 53 route | 5 route |
| Wall, open floor 3 cells or less away (345) | 286 route | 316 route |
| Wall, 9 to 19 cells away (164) | 112 route | all refused |

- On DE-commons_000008 the code reads a grey hall as wall. Taps there now get no route. Before, the route started up to 96 px from the tap.
- Reviews of the merged page (ux and a11y): no open blocker after the fixes. The ux blocker was the escape map button in the reading view: a press turned the map off. The fix ends the reading view and keeps the view under it.
- Other fixes from the reviews: a lighter purple for the pressed reading button in dark mode, and a text for the route picture.
- Also: one "Finding the route" message for each open, a keyboard marker that stays whole in the frame, and no refusal message after a view change.
- Not changed: the escape map button is an on and off switch, but it looks like one of three choices. This was so before this round.
- Not changed: all six Korean plans have no route and are at the end of the gallery.
- Tests: 104 pass.
