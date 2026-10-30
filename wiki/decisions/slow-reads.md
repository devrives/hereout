---
type: decision
title: Upload as a job; no zoom call after a slow main call
status: accepted
updated: 2026-10-30
checked: b83441a
sources:
  - owner:2026-10-30
  - src/hereout/app.py
  - src/hereout/reader.py
  - src/hereout/web/app.js
  - tests/test_app.py
  - tests/test_reader.py
---
# Upload as a job; no zoom call after a slow main call

## Context

- The test on 28 photos outside the eval set gave six photos with more than 120 s (see [Tests on photo sets](../timelines/photo-set-tests.md)).
- The page sent the photo in one request and waited for the answer. Cloudflare stops a request after about 100 s, so these uploads can fail on the live site.
- Each model call stopped after 120 s, and the live path tried no call again. Two photos of the test took more than 240 s, because a main call failed and the test script tried again.
- After the main call, the reader makes a second call (the zoom call) for suspect exits. The zoom call only moves those exits a little (see [Check of the exit marks](exit-mark-check.md)).
- On 2026-10-30 the owner accepted two proposals: the upload as a job, and no zoom call after a slow main call.

## Decision

- `POST /api/plan` flattens the photo, starts a job and answers at once with a random job id (status 202).
- `GET /api/plan/<id>` gives status 202 while the job works, and the answer when it is ready. An unknown or old id gives 404.
- The server keeps a job and its answer in memory for 10 minutes at most, and 64 jobs at most. Four threads do the jobs.
- The page asks for the answer every 2 s. A bar moves while the server reads the photo. Status messages come at 60 s and at 4 minutes. After 6 minutes the page stops and shows an error.
- A lost connection, a rate limit (429) or a proxy error (502 and higher) does not stop the wait. The page asks again.
- The page keeps the job id for the tab. After a reload, the page asks again for the same answer.
- When the user opens another plan during the wait, the page keeps on asking. The ux review found that a sample opened during the wait lost the upload.
- The answer opens the plan only when the user waits for it. That is at the photo button, or in the photo plan that it replaces, with no tap or key there after the upload. Otherwise a button shows the plan of the photo, so an open sample stays.
- With a plan open, the bar with the wait note and that button stays at the foot of the screen. The ux review found the button out of view.
- The page keeps the plan of the last photo apart from the sample plans. Back and Forward after a sample find it again.
- The photo button stays in the keyboard focus during the wait (`aria-disabled`, not `disabled`). The a11y review found that the focus went to the page body for the whole wait.
- The reader tries the main call one more time after a timeout or a 5xx answer. A 4xx answer gets no second try.
- The reader makes no zoom call when the main call took more than 45 s. A zoom call stops after 60 s.

## Consequences

- No request of the upload stays open for longer than the flattening step of the photo.
- A main call that fails one time can still give a reading. The worst case is two main calls of 120 s and the wall pass.
- A failed try costs the worst case in the spend ledger, because the provider can bill a timeout.
- After a slow main call, a suspect exit keeps the point of the main call.
- The server holds each answer in memory for up to 10 minutes. Before, it held nothing after it answered.
