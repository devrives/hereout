---
type: decision
title: Fix the weak plan types
status: proposed
updated: 2026-10-29
checked: 6d5f2fb
sources:
  - owner:2026-10-29
  - commit:6d5f2fb
---
# Fix the weak plan types

## Context

- The gallery check of 2026-10-29 found five weak types of plan. See [Close the outside of the building and give closed rooms a door](outside-and-closed-rooms.md).
- The owner asked for a fix for each type (2026-10-29). Then the owner told the agent to go ahead with the proposal: code fixes first, then a new read of the weak plans.

## Decision

The code changes are in commit 6d5f2fb on branch `ortho-net`. They make no model call.

- Photo maps: `photo_map.py` measures three shares inside the plan box. The shares are the paper tone, the fine texture and the strong colour. A plan with paper under 0.35, texture over 0.34 and colour over 0.3 is a photo map. A photo map gets no walls and no ways out. The page names the exits and tells the user to follow the route on the map. It hides the controls for routes and walls.
- Outdoor words: `outdoor_areas` in `ink_walls.py` reads the widest text lines in each large open area, at most 3. It uses the RapidOCR text model. A word for an outdoor area makes that area outside. Examples are a roof, a yard, a street, a car park and a garden. The word list is `OUTDOOR_WORDS`.
- The text model reads Latin script and Chinese characters. Korean and Cyrillic need other text models.
- Floors with no exit: a tap finds no way out in a large open area (5 percent of the open cells or more). Then the page says that no exit is on that part of the plan. It points to "Mark the exit". That mark goes with the other exits and does not replace them.
- Legend frames: a frame that fills its box can have up to 12 corners, for example with a heading tab or a divider. The agent also tested a rule that dropped an exit off the drawing with a text line on its right. The rule changed one gallery plan, and there it dropped a real exit (RU-commons_000165). The rule is not in the code.
- New read of 30 weak plans: sheets with many floors, station diagrams, yards and exits on the margin. The read cost 0.487 USD. A look at each plan kept the new reading for 22 plans. It kept the old reading for 8 plans, because the new lines crossed text panels or the new reading lost an exit.

## Consequences

- The photo map rule found the 8 photo maps of the 203 gallery plans and no other plan. The nearest drawing (MY-commons_000312, a platform plan with yellow bands) has a paper share of 0.46.
- On the 158 drawn plans of the gallery check, no line crosses a hard wall. The mean share of open floor with a way out went from 0.928 to 0.931. The plans gave 747 exits, before 705.
- Outdoor words found the roof on DE-commons_000020 and DE-commons_000021, the court yard on US-commons_000003 and a park on FR-web_more_000007. The reading took 0.2 to 2.3 seconds on a loaded server.
- After the new read, sheets with many floors have exits on each floor (FR-web_more_000009: 2 exits on one floor before, 8 exits on four floors after).
- Open limits: yards with no word (US-commons_000225), lines over text panels on some station diagrams (CN-commons_000076, JP-commons_000384), exits in a legend with no frame (DE-commons_000013).
- The ux and a11y reviews ran two rounds. The agent fixed each finding.
