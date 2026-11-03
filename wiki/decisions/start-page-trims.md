---
type: decision
title: Fewer repeated lines on the start page
status: accepted
updated: 2026-11-03
checked: cfafc0e
sources:
  - owner:2026-11-03
  - src/hereout/web/index.html
  - src/hereout/web/app.js
  - src/hereout/web/style.css
  - src/hereout/app.py
---
# Fewer repeated lines on the start page

## Context

- On 2026-11-03 the owner asked the agent to use the start page and to polish it. The owner also asked for a check of the header and the footer for text that does no work.
- The agent used the page at 390 and 1280 px. It opened samples from the hero and from the gallery, tapped the plan and followed the steps. It also changed the language to Korean, opened the larger plan and marked an exit. The flow worked. The text had three repeats.

## Decision

- The count row under the hero goes ("203 plans · 24 countries and regions"). The heading of the samples gives the same counts. On a wide screen, the two were about 340 px apart.
- The server still puts the counts in the heading of the samples (`app.py` `counts_page`, formerly `proof_page`).
- The line under the demo video keeps only "No sound, with captions". The play button shows the length. The "Photo credits" link goes, because the disclosure under it is "Video text and photo credits".
- The footer keeps "Built solo by devrives for the Meta Global AI Developer Hackathon", the code link and the credits link. The list of tools goes. The cards of "About HereOut" and the README name the model and the tools.
- Below 360 px, the header keeps "Samples" and hides "Code" (before: the reverse). The footer links the code. Without the count row, no other link went to the samples there (ux review).
- The other header links stay. Each link goes to a part of the page or to the code.

## Consequences

- This supersedes two earlier parts:
  - the count row of [Fixes of the plan page and the start page](plan-page-fixes.md)
  - the line under the video of [Hover and press feedback, and a calmer demo player](ui-detail-pass.md)
- This changes `app.py`, so `save_answers.py` must run after the deploy.
