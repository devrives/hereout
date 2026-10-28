---
type: decision
title: Check the exits with numbered marks
status: proposed
updated: 2026-10-28
checked: 77d443d
sources:
  - owner:2026-10-27
  - owner:2026-10-28
  - src/hereout/reader.py
  - https://arxiv.org/abs/2310.11441
  - https://simonw.substack.com/p/metas-new-model-is-muse-spark-and
  - https://dev.meta.ai/docs/image-understanding
  - https://dev.meta.ai/docs/muse-spark-open/settings
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC10575354/
  - https://arxiv.org/abs/2507.00008
---
# Check the exits with numbered marks

## Context

- The model sometimes puts an exit outside the building. On PT-commons_000107, ten exits were on the pavement, about 80 px below the exit signs.
- The owner asked if research shows the best way to ask a model for a point (2026-10-27).
- No study compares 0 to 1000 coordinates with pixel coordinates on one model. Each model family uses the format of its training.
- The grounding tool of Muse Spark gives points and boxes in 0 to 1000 coordinates. One public test shows this; Meta gives no document. The prompt in `reader.py` uses the same format, so it stays.
- Set-of-Mark prompting draws numbered marks on the image. The model then names a mark and gives no coordinates. The paper shows a large gain on GPT-4V.

## Decision

- Local candidates do not work. A detector for green exit signs found all 16 signs on PT-commons_000107. On the 203 gallery plans, it found no candidate on 115 plans. Only 80 of 866 saved exits had a candidate near them.
- The test used the saved exits as the marks. A second call sees the marks and keeps, moves or drops each one. The call can also add an exit.
- The owner approved the model calls (2026-10-28). The test read 30 plans: PT-commons_000107 and 29 plans from a shuffle with seed 30.
- The test result, judged by eye on each overlay:

| Change | Plans |
|---|---|
| Keep, move and drop made the exits better | 15 |
| No clear change | 14 |
| Better and worse changes on one plan | 1 |
| Worse | 0 |

- The moves put exits from the pavement or the paper back on the building line. The drops removed exits in the legend and outside the plan.
- About half of the 58 added exits were wrong. They were on an arrow, on the paper, in the legend or on a stair with no exit. So the check must not add exits.
- The check is not in the product. The owner decides on it.

## Consequences

- PT-commons_000107: of 762 tap routes, 55 walked along the pavement with the old exits. With the checked exits, 3 did. The mean route length went from 451 px to 330 px.
- On the 29 plans with a "you are here" point, the route counts did not change.
- The check costs one more call for each plan, about 0.008 USD. The call can run at the same time as the zoomed "you are here" call.
- The moved PT exits are still about 30 px outside the building line. The check makes the error smaller but does not remove it.

## One call with a better prompt

The owner did not want a second call for each plan (2026-10-28). The owner asked for a better read prompt that follows the Meta guidance.

The Meta image understanding page gives these rules:

- Muse Spark gives positions on a 0 to 1000 grid of the image that it received.
- A point answer is `{"x": <int>, "y": <int>}`. A box answer is `x_min`, `y_min`, `x_max`, `y_max`.
- Keep the request direct, and put it in the user message next to the image. Keep the system prompt small.
- For boxes, the words "You are an object grounding expert" and "do not miss any objects" give better recall.
- The model can give a value a little outside the grid, for example 1001. Clamp such a value.

A pilot on 5 of the 30 plans used a prompt in this style:

- A rule "use only the floor with the you are here mark" removed exits on other floors. On two station plans, the exits moved to the floor of the reader.
- The exits on the legend went away.
- PT-commons_000107: the bottom exits stayed on the pavement. The model said that it pointed to the exit signs. It gave one y value for all ten signs, 50 to 120 px below them.
- PT-commons_000107 on a square image with a white border: the error was larger. So the aspect ratio of the image is not the cause.

The parser now clamps a value from -10 to 1010 to the grid. It drops a value outside that range.

## Country hints

The owner asked to test country hints (2026-10-28). The question was: one prompt for all countries, or a prompt for the country of the plan.

- Arm "all": one prompt with hints for six countries.
- Arm "one": only the hint for the country of the plan. The server can get the country from the `CF-IPCountry` header, with no model call.
- The test read 5 plans from Russia and 5 plans from Japan with each arm, 20 calls.

| Result | Plans |
|---|---|
| Arm "one" better | 2 |
| No clear difference | 8 |
| Arm "all" better | 0 |

- One of the two "one" wins was a plan with a single level. The hint is not about such a plan, so that win is noise.
- The Russian hint did not stop exits on the legend. On RU-commons_000346, both arms put three exits in the legend box.
- On the five plans with a result for the prompt with no hint, the hints gave about the same exits.
- The floor rule of the base prompt already gives the result of the Japan hint.
- A filter that drops exits outside the box of the floor drawing does not work. The box of the model includes the legend. The filter also dropped a real exit.

So country hints do not go into the product now. The errors that stay are positions and legend symbols, not knowledge of a country.

## Product change

- The owner approved the base prompt of the pilot for the product (2026-10-28). The prompt has the floor rule and no country hints.
- `reader.py` sends this prompt in the first call. The answer has `floor_drawing`, `you_are_here` and `final_exits` in the Meta point and box format.
- The zoomed second call for "you are here" did not change.
- The mark check is not in the product. The owner did not want a third call.

## Zoom on suspect exits

The owner asked for ideas from similar work (2026-10-28):

- A study of German emergency plans trained a symbol detector on 403 labelled photos. Its data is not public. So a detector for the symbols of many countries is too large for this project.
- GUI grounding work zooms into a crop around a first point. Later work zooms only when the point is uncertain. A zoom on an easy case can remove the context.

The test sent, in one call, the whole plan and crops around some first-pass exits:

- Baseten accepts at most 8 images in one request. The Meta page gives 50. So the test put four crops on each sheet.
- On PT-commons_000107, a zoom on all 16 exits moved the 10 bottom exits near the signs. It also moved 3 correct top exits to wrong places.
- A model-free signal separated the two groups. It is the distance from the exit to the nearest green or red pixel. The correct exits were at 0.5 percent of the long side or less. The wrong exits were at 2.6 percent or more.
- With a gate of 1.5 percent, the test read 6 plans. 4 were better, 2 had no clear change, and none was worse.
- The model answered "no exit" for crops on the legend and outside the plan. So the zoom removed the legend exits that the prompt did not stop.
- One exit on JP-commons_000369 moved 8.5 percent of the long side to an empty area. A cap on the move can stop such a move.
- When no exit passes the gate, the zoom costs nothing.

The owner put the zoom into the product on 2026-10-28. The next section gives the details.

## Zoom in the product

- The owner chose a separate call for the zoom. It runs at the same time as the zoomed "you are here" call, so the wait does not grow (2026-10-28).
- `reader.py` finds the suspect exits with `suspect_exits`. The zoom call goes only when there is a suspect exit. It takes at most 28 crops, on 7 sheets.
- A move of more than 7 percent of the long side is not used. An exit with the answer "no exit" goes away, but at least one exit stays.
- On the 203 saved gallery readings, 142 plans have a suspect exit. On a plan with no green or red marks, all exits are suspect.
- The review set read 8 plans with the product code: 16 to 27 seconds and 0.010 to 0.026 USD for each plan. Against the gallery readings, 4 were better, 1 had no change and 3 had better and worse changes. NO-openverse_000112 had 7 suspect exits that were correct, and they stayed correct.
