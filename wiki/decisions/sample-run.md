---
type: decision
title: One run of the sample photos through the page, on /review
status: accepted
updated: 2026-11-01
checked: 8636f92
sources:
  - owner:2026-11-01
  - scripts/site_run.mjs
  - docker-compose.yml
  - src/hereout/app.py
---
# One run of the sample photos through the page, on /review

## Context

- The gallery samples open from saved readings. Most of them are older than the current code, and later scripts changed some of their points.
- The owner asked (2026-11-01) for one run of the sample photos through the site when the interface is final. The run has no post-processing, and its results go to `/review`.
- A standing rule says that no photo goes to the live server for a test.

## Decision

- `scripts/site_run.mjs` sends each original photo through the photo button of the page on a local server with the same code and the model key. Each photo gets its own address in the `cf-connecting-ip` header, so the limit of 12 reads for each address does not stop the run.
- Each photo went once. The script has no retry, and nothing changed the answers after the page showed them.
- For each photo, the run keeps the answer, the plan image, the page view and the reading view. These and one index page are in `_workspace/hereout-gallery/review/`, outside the repository. The live server shows them on `/review/` with `HEREOUT_REVIEW` set to 1.
- The old test pages of that folder are in `_workspace/hereout-review-old-2026-11-01`.

## Consequences

- The run used commit 8636f92. All 203 plans opened, with no failure. The median time from the upload to the open plan was 23.3 s and the longest 63.1 s.
- One plan had no exit. Eight plans were photo maps. The text read gave the words of 200 plans.
- The second look ran on 121 plans, 76 needed none, 3 skipped it after a slow first call, and 3 second looks failed.
- On the 28 dev plans with blind labels, at 5 %: precision 0.455, recall 0.448, every exit right on 6 plans. At 10 %: 0.715, 0.704 and 12 plans. One dev plan had another frame size and was not scored.
- The run cost 4.66 USD by the local spend ledger.
- `/review/` is public while `HEREOUT_REVIEW` is 1. The page has noindex, and robots.txt stops all crawlers.
