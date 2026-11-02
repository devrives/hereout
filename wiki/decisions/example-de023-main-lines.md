---
type: decision
title: A German hotel plan as the example, main way lines and a short motion
status: proposed
updated: 2026-11-02
checked: b099fd0
sources:
  - owner:2026-11-02
  - src/hereout/web/app.js
  - DESIGN.md
  - scripts/score_exits.py
---
# A German hotel plan as the example, main way lines and a short motion

## Context

- The owner (2026-11-02) said that the example plan looks bad and that its answer is not right. The owner asked for an example from a country that is not Russia.
- The owner also said that the lines are too busy and that the motion must be short. The owner wants to see the motion on `/review` before a new video.
- The example was RU-commons_000164. The ways out showed a line into each room, many arrows and lines across the legend of the plan.

## Decision

Example plan:

- The proposed example is DE-commons_000023 (a hotel floor in Dresden), with a tap in the long corridor at photo pixel 800, 620. Its three exits are the three stairs. The blind dev labels match all three at a radius of 10 % of the floor box.
- The route goes to the middle stair (exit 2), and the second way goes to the lower stair (exit 3).
- Checks by eye removed other plans. On HK-commons_000179, two stair landings are exits in the answer. On DE-commons_000022, exit 2 is at the dead end of a corridor. On DE-commons_000011, the second way crosses the courtyard.
- On JP-commons_000384, the route crosses blank paper, and a tap on the "you are here" mark gives no route. On JP-commons_000268, the plan marks exit 3 as closed.

Drawing and motion:

- The ways out show only the main lines, and every line shown joins an exit. The first preview cut low-flow lines, links and bridges out of the network, so the lines had gaps. The owner rejected that preview (2026-11-02).
- Now only spurs go. A spur is a piece with a free end (not at an exit), up to the next fork. A spur shorter than 16 units does not show, and the pass repeats. A long spur with its free end off the building outline does not show (ux review). Spur lengths use the plan unit with no phone floor, so all widths show the same lines (ux review). A piece that joins no exit does not show. All lines have one width. Bridges get no arrows. The arrows are two times farther apart (ux review: a line keeps at least one arrow).
- With a route on the plan, the ways out fade to 30 %. The legend then does not name them, because faded lines do not have the contrast of a mark (a11y review).
- The start is a location dot as on a map app: a blue dot with a white rim in a soft halo. The dot has no text and no arrow, and the legend names it. A beam toward the first move was tried and removed, because it muddied the route (ux review). The owner said that the old mark did not look natural (2026-11-02).
- The plan shows no step numbers. This replaces the step dots of [The current step under the plan](current-step-card.md) and [Fixes of the plan page and the start page after three reviews](plan-page-fixes.md). The lit step still shows on the plan, and the step card and the step list keep the numbers.
- The reveal is shorter: 160 ms between two exits, 1 s for the ways out, 0.7 to 1.2 s for the route.
- On a narrow screen, the size unit of the marks is at least 4 CSS px, so an exit mark is about 18 CSS px.

## Consequences

- The drawing change applies to every plan on the live site.
- The hub script `hero_loop.mjs` takes `--sample` and `--tap`. Its loop is 9 s and does not scroll, because the step card is under the plan.
- `/review/motion/` shows the old loop and the new loop side by side. The start page and the demo video keep RU-commons_000164 until the owner accepts the new example.
