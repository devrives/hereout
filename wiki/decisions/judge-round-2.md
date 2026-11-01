---
type: decision
title: "Judge review 2: test pages off, text-block exits, X-marked voids, step fixes, exit scores"
status: accepted
updated: 2026-11-01
checked: 73ef54e
sources:
  - owner:2026-11-01
  - src/hereout/app.py
  - src/hereout/legend.py
  - src/hereout/voids.py
  - src/hereout/steps.py
  - src/hereout/web/route.js
  - src/hereout/gallery_order.json
  - scripts/score_exits.py
  - docker-compose.yml
---
# Judge review 2: test pages off, text-block exits, X-marked voids, step fixes, exit scores

## Context

- On 2026-11-01 a second judge agent gave 5.7 of 10, or 5.4 when judges cannot read the code.
- The owner said that the code will be public at the submission. The owner told the agent to do every item of the review with sub agents.
- The owner chose gallery samples for the video, with no shots of a real phone (2026-11-01).
- Two items have their own pages: [the plan words and translation](plan-language.md) and [the second look on samples](second-look-on-samples.md).

## Decision

- Test pages: `/review/` and `?set=review` are off unless `HEREOUT_REVIEW=1`. The production compose sets 0. The judge found them open on the live site.
- Text blocks (`legend.py`): an exit on a line of running text goes. A block is three or more long text lines, stacked close, with almost no other ink.
- The block comes from the OCR text, not from the floor box. On RU-commons_000259 the floor box of the model holds the text block.
- An exit goes only when its nearest text box is a line of the block. Short exit labels on Japanese station plans are not running text, so those exits stay.
- X-marked voids (`voids.py`): a rectangle with both diagonals in ink is hard wall, unless an exit is in it. The test finds four paper triangles that make the rectangle.
- A Hough-line version did not ship. It took 9 to 15 s for each plan and gave a false hit on RU-commons_000243.
- Steps: a turn back round a wall is two turns. A walk that switches often between two near ways is one slanted walk.
- Gallery order: FR-web_more_000055 and RU-commons_000259 go to the end. Their routes still go round the outside or to a far stair.
- Exit scores (`scripts/score_exits.py`): the predicted exits match the labels one to one, within a radius. The radius is a share of the labelled floor box. The script gives precision, recall and the share of photos with every exit right.
- Labels for the 28 holdout photos: an agent (Claude) marked the exits by eye, from the photos only, before it opened any model output. The labels stay outside the repository.

## Consequences

- The text-block rule drops 2 of 909 exits on the 203 gallery plans, both on running text. Looser limits drop the same 2.
- The void rule finds 4 lift shafts on 203 plans. On the other 199 plans, the open floor does not change, and `route_found` stays at 193.
- Steps: on 28 other routes on 9 plans, no step text changed.
- Labels: 112 exits on 26 photos, 22 of them unsure. Two photos cannot be judged: a town map and a photo that cuts the plan.
- Score of the 2026-10-29 run, radius 5 % of the floor box: precision 0.42, recall 0.52, every exit right on 4 of 26 photos. At 10 %: 0.62, 0.74, 8 of 26.
- Errors of that run: points on name plates or signs, points on the street, one exit given twice, direction signs taken as exits.
- A third judge agent (2026-11-01, code read as public) gave 6.4 of 10: Impact 5.5, Meta tooling 7.0, Technical depth 7.0, Demo 6.5.
- It found exit 3 of RU-commons_000033 under the paper, and the second look's point there refused by the 7 % limit. That plan left the first plans, and the submission links DE-commons_000022.
