---
type: decision
title: Short time limits for the model calls
status: accepted
updated: 2026-10-31
checked: 3bd920b
sources:
  - owner:2026-10-31
  - src/hereout/reader.py
  - src/hereout/web/app.js
  - tests/test_reader.py
---
# Short time limits for the model calls

## Context

- On 2026-10-31 the owner asked if more speed work was possible. The owner then accepted a paid test of the read call (about 2 USD).
- A gallery plan opens in 0.13 to 0.48 s from a saved answer. The page makes the way lines in a worker, in 0.13 s (median, node on the server). The wait for a new photo is almost all model calls.
- The page text of [Upload as a job; no zoom call after a slow main call](slow-reads.md) came from the old limits. The main call stopped after 120 s, the zoom call after 60 s.

## Decision

- The main call stops after 45 s (`CALL_TIMEOUT`), and it gets one more try, as before.
- The zoom call stops after 25 s (`ZOOM_TIMEOUT`). When it stops, the exits keep the points of the main call, as before.
- No zoom call when the main call took more than 30 s (`ZOOM_SKIP_AFTER`). The time starts at the first try, so a second try also skips the zoom call.
- The page stops after 3 minutes, before it stopped after 6. The status texts come at 60 s and at 2 minutes and give the new times.
- Why: a call that stops its answer holds the user until its time limit. At low effort, 108 of 109 test calls with an answer took 4 to 30 s.
- Rejected: a smaller image to the model (long side 1024 px, not 1600 px). The call was 25 % faster, but the exits changed much more than between two runs of the same setting.
- Rejected: `reasoning_effort: minimal`. It was not faster than `low`, and one of its calls gave no answer in 120 s.
- Rejected: wall steps during the model call. The model gives the box of the plan on every gallery plan, and the wall steps use that box. Only the colour step (`_chroma`, 0.15 s) does not need it.
- Rejected: one step for each short walk in the steps (`directions`). The test walker went off the way on 16 to 18 routes, before on 1. The short steps into an exit follow real door jambs (RU-commons_000140).

## Consequences

- Test of the read call, on 30 gallery plans (each setting one time, the base two times):

| Setting | Median time | 90th percentile | Exits that match the base run |
|---|---|---|---|
| Base (1600 px, low effort) | 8.4 s | 12.3 s | (reference) |
| Base, second run | 9.0 s | 12.1 s | 99 of 120 |
| Minimal effort | 8.2 s | 10.8 s | 101 of 116 |
| 1024 px, low effort | 6.3 s | 9.2 s | 62 of 127 |

- An exit matches when it is within 0.03 of the long side of the plan. 5 of 124 main calls gave no answer and ended at the 120 s limit.
- The full read of 15 gallery plans, one at a time: 4 of 10 zoom calls gave no answer and ended at 60 s. One main call ended at 120 s.
- With the new limits, the same calls give a mean wait of 26.1 s, before 40.8 s. The longest wait is 63.8 s, before 143.9 s. The median stays at 23.7 s.
- The worst case is two main calls of 45 s, each with up to 10 s to connect, and the wall pass. Before, each call had 120 s.
- When both main calls fail, the user gets the plan to mark by hand, before the page stops. The stop at 3 minutes covers the upload, a wait for a free job thread and the wall pass.
- After a reload late in the wait, the page says the last status text again. The ux and a11y reviews found the stop time lost after a reload.
- Known limit: with 4 stalled jobs at one time, a fifth upload waits for a free thread and can pass 3 minutes.
- A call that answers in more than 45 s now gets a second try. One test call answered after 79.9 s with 632 tokens; a second try takes about 9 s.
- The test calls cost 1.51 USD from the local cap.
- Some routes start away from the exit and then turn back. On 3 checked routes a wall blocks the short way, so the route is correct.
