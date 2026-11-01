---
type: decision
title: No vote of several reads for the exits
status: rejected
updated: 2026-11-01
checked: cdc1c9b
sources:
  - owner:2026-11-01
  - scripts/vote_reads.py
  - src/hereout/reader.py
  - scripts/score_exits.py
---
# No vote of several reads for the exits

## Context

- The exit scores were low: on the dev set, precision 0.47 and recall 0.39 at 5 % after all rules ([Judge review 3](judge-round-3.md)).
- The model gives different exits in different reads of one photo ([The second look on the gallery samples](second-look-on-samples.md)).
- The owner agreed to a test of a vote (2026-11-01). HereOut reads each photo three times and keeps an exit where two or more reads agree. The owner asked for no credit overrun.

## Decision

- HereOut keeps one main read. The vote did not ship.
- `scripts/vote_reads.py` stays for a later test. It makes K main reads of each dev plan and scores the single reads and the votes with the rules of `score_exits.py`.
- `ModelClient` has a `temperature` attribute. The server keeps 0.

## Consequences

- The test used the main call only (with the y fix), on the 29 dev plans that can be judged.
- At temperature 0, two reads agree on 0.81 of their exits. On all 29 plans at 5 %, one read gave precision 0.395 and recall 0.427 (mean of three reads). The vote of two of three gave 0.411 and 0.439.
- Twenty plans have three reads at both temperatures. On them at 5 %, one read at temperature 0 gave 0.502 and 0.487, and its vote 0.531 and 0.500.
- At 10 % the vote lost recall (0.737 to 0.721 on those 20 plans).
- Temperature 0.7 was worse: two reads agree on 0.66 of their exits, and one read gave 0.492 and 0.455. Its vote gave 0.511 and 0.442. A vote of three of six reads (both temperatures) was not better than the vote at temperature 0.
- The gain is 1 to 3 points at 5 %, a few hits on fewer than 150 labels. It costs three calls for each photo. Most errors are the same in each read. The point is on a sign and not on the door, or a direction sign is an exit.
- Saved reads: 90 at temperature 0 and 69 at temperature 0.7 (`_workspace/hereout-vote-dev`, outside the repository), 1.03 USD by the saved costs. The local ledger grew by 2.51 USD, because it counts a failed call at its worst case.
