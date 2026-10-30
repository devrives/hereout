---
type: decision
title: Fast first tap and smaller sample plans
status: accepted
updated: 2026-10-30
checked: 0002b5c
sources:
  - owner:2026-10-30
  - src/hereout/web/route.js
  - src/hereout/web/network-worker.js
  - src/hereout/web/app.js
  - src/hereout/gallery.py
  - src/hereout/app.py
  - scripts/save_answers.py
  - tests/test_network.py
  - tests/test_app.py
---
# Fast first tap and smaller sample plans

## Context

- On 2026-10-30 the owner asked for more speed. The work on the photo path of 2026-10-29 is in [Fast processing of a new photo](photo-speed.md).
- The measurement of the live page ran in headless Chromium at 390 px. The CPU was 4 times slower (a mid-range phone), and the network gave 9 Mbit/s.
- The first tap on a sample plan took 0.6 s to 2.8 s before the route showed. The page stopped for all of this time.
- A tap needs the route tree to one exit for the nearest exit and for up to three other exits. The page made each tree when the tap came. On a phone, one tree takes about 0.3 s to 2 s.
- The page also made the escape field, the costs to each exit and the open areas with slow loops.
- A sample plan came as one answer of 285 KB (compressed), because the plan image was in the answer as text. The edge and the browsers did not keep it.
- Files under `/static/` have a content hash in the URL, but the browsers kept them for 4 hours only.

## Decision

- After the way network, the worker makes the tree to each single exit, and the network of a wing with its trees. It makes one tree for each task and sends it to the page.
- A tap before the trees that it needs waits for them, with the status "Finding the route…", as for the way network. The page tells the worker to make those trees first. The ux review found that the page stopped for seconds when it made the trees itself.
- A tree from the worker and a tree that the page makes give the same route (tests in `tests/test_network.py`).
- A worker that still makes trees stops when a new plan opens, when a plan with no ways out opens, or when the plan closes.
- The worker sends only what a route needs of a tree, with one byte for each value. That is the best move of each cell and the move back of each state. A plan with 22 exits needs 11 MB in place of 47 MB.
- Faster loops with the same output: a heap in typed arrays with the same order, and typed arrays for the moves to the eight neighbours.
- `scripts/save_answers.py` saves the plan image of each sample as a WebP file (quality 80) beside the answer. The answer has the URL of the file.
- The server sends a saved answer only when its image file is there.
- The edge and the browsers keep the WebP files for one year. They keep a file under `/static/` for one year only when its `?v=` is the hash of the file now. A page from before a deploy can ask for the old hash and get the new file. That file must not stay under the old URL (code review).
- A sample in the tab from before a deploy can name an image that the server deleted. The page then asks the server for the sample one time again.
- The status lines change when the image of the new plan loads, not before. A wait text stays while the image loads, and an image that does not load gives one message only (a11y review).
- The answer for a photo of a user keeps the JPEG in the answer. A WebP encode takes about 0.4 s on the one CPU of the server, more than it saves.

## Consequences

- On 195 sample plans, the route code gives the same output as before. The check covers the field, the costs, the network and each tree. It also covers the routes and steps from 25 points.
- The longest stop of the page after a tap on three samples, with the CPU 4 times slower. The machine had other load, so the times changed by up to 0.3 s from run to run.

| Sample | Before | After, trees in | After, tap at once |
|---|---|---|---|
| JP-commons_000066 | 2.7 s | 0.25 s to 0.45 s | 0.32 s |
| RU-commons_000001 | 0.59 s | 0.15 s to 0.19 s | 0.22 s |
| US-web_more_000029 | 1.4 s | 0.17 s to 0.21 s | 0.28 s |

- The worker made all trees of US-web_more_000029 (12 exits) about 2.4 s after the plan showed. A tap before that shows "Finding the route…" until its trees come. The page does not stop in this time.
- Times on a desktop, for six large plans together:

| Part | Before | After |
|---|---|---|
| Escape field | 537 ms | 110 ms |
| Costs to each exit | 318 ms | 67 ms |
| Open areas | 263 ms | 52 ms |

- A sample plan is now an answer of 3 KB and an image of 139 KB on average (compressed): half the bytes. A second open of the same sample loads the image from the edge or from the browser.
- The saved answers changed their key. After a deploy, `scripts/save_answers.py` runs again (see [Sample gallery](../components/gallery.md)).
