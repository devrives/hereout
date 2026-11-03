---
type: decision
title: "Judge review 7: closed exits, refused taps, share card"
status: accepted
updated: 2026-11-03
checked: 6b50dd1
sources:
  - owner:2026-11-03
  - src/hereout/pipeline.py
  - src/hereout/app.py
  - src/hereout/web/app.js
  - src/hereout/web/reading.js
  - src/hereout/web/style.css
  - src/hereout/web/index.html
  - tests/test_model_reading.py
  - tests/test_app.py
  - DESIGN.md
---
# Judge review 7: closed exits, refused taps, share card

## Context

- A judge agent scored the deployed site of 2026-11-02 at 6.6 of 10. The owner told the agent to do items 2, 3, 4, 6 and 8 of its report (2026-11-03).
- Item 2: on JP-commons_000268 the "If blocked" exit was "To street level closed". The plan itself says that this exit is closed. On US-commons_000003, Exit 7 was "south elevator exit", on a plan that says not to use the elevator.
- Item 2 also: a name such as "Exit 1: 4 To street level" shows two numbers.
- Item 6: on a phone, a refused tap left the old route and the step card. So the tap looked as if it did nothing.
- Item 8: the start page had no share card and did not name Muse Spark above the fold. The Arabic view buttons pushed the larger-plan button to a second row at 390 px.

## Decision

- An exit whose model label says closed, out of service, no exit, lift or elevator goes, in the code (`not_exit` in `pipeline.py`). When every exit has such a label, all exits stay.
- The rule knows these words in English. It knows the word for lift in seven more languages, and the word for closed in Japanese and Korean.
- "Keep closed" is a door rule, not a closed exit, so that exit stays. A lift word next to a stair or door word ("Stairs next to lift") names a place, so that exit stays too (ux review).
- The "What Muse Spark read" card shows such an exit as "dropped by HereOut: its label says closed or lift".
- The prompt does not change. A prompt change needs a paid run on the holdout photos, and no holdout reading has such a label. On the 203 gallery plans, the rule drops one exit on JP-commons_000268 and one on US-commons_000003, and no other exit.
- An exit name leaves out a plan number at the start of the label: "Exit 1: To street level". When two names would then be the same, the plan number stays, set apart: "Exit 1: 4 · To street level" (ux review: in a station the signs carry that number).
- A refused tap removes the old start, the route and the step card. The tap says "I am here", so a route from the old spot is wrong. The pill on the plan gives the reason, and then asks for a new tap.
- The live line adds "The route from your last spot is cleared." (a11y review). After 3.5 s, the card and the line ask for a tap again.
- While the reading shows on the plan, the tap pill does not show.
- The view buttons and the larger-plan button stay on one row. On a phone a long label takes two lines in its button. A button goes to a second row in the group only when its longest word does not fit (Russian at 320 px, larger text).
- The start page has Open Graph tags. The share card is `og.png` in the video folder, outside the repository, because it shows a plan photo. It carries the CC BY-SA attribution of that photo.
- The hero line names "Muse Spark by Meta".
- The reading card stays in English in every language. The judge asked for a translated legend, but the whole card is English and marked so.
- The tap hint on photo maps did not show in any test (390 px, 1280 px, after a sample change). The code now also hides it on a photo map.

## Consequences

- JP-commons_000268 has two exits and US-commons_000003 has six.
- The demo film gets a second plan (RU-commons_000164) for the second look on crops, and a line on accuracy. Its start and its end card are shorter.
