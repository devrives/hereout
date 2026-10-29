---
type: timeline
title: Tests on photo sets
updated: 2026-10-29
checked: cee355f
sources:
  - owner:2026-10-29
  - scripts/run_set.py
  - src/hereout/reader.py
  - src/hereout/app.py
---
# Tests on photo sets

## Entries

- 2026-10-27: The first run on the 203 gallery photos. See [Sample gallery](../components/gallery.md), section "First run".
- 2026-10-29: The owner asked for a test on photos that are not in the eval set. The set has 28 photos from Wikimedia Commons, from 14 countries. The folder is `_workspace/hereout-holdout/` in the hub.
- 2026-10-29: The selection removed each photo that is in the eval set or near to one: by title, by source address and by a perceptual hash. It also removed the photos of four buildings that are in the eval set.
- 2026-10-29: The Openverse search gave no answer in 40 s, so all photos came from Commons. Each photo has a long side of 3200 px or less, as the page sends it.
- 2026-10-29: The run on the 28 photos (`scripts/run_set.py`, two workers) found a route on 26 photos. The mean share of open floor with a way out is 0.886 (median 0.960).
- 2026-10-29: The saved readings cost 0.317 USD. Two more readings were not saved (see the last entry).
- 2026-10-29: With the model calls, each photo took 36.4 s (median), 169 s (90th percentile) and 281 s at most.
- 2026-10-29: The server work without the model took 4.4 s on average on one host core. The text boxes took 2.4 s and the walls 1.8 s.
- 2026-10-29: A check by eye at screen size is not a ground truth. On 16 photos the exits look correct. On 9 photos some exits are missing or false. On 3 photos the plan is too small to judge, or the photo cuts the plan.
- 2026-10-29: Six photos took more than 120 s. The reader makes the main call and then, for suspect exits, a second call. Each call stops after 120 s.
- 2026-10-29: Two photos took more than 240 s, so a call failed and the script tried again. The gallery run of 2026-10-27 had a highest time of 58.7 s.
- 2026-10-29: The page sends the photo in one request through Cloudflare and waits for the answer.
- 2026-10-29: `scripts/run_set.py` failed on two photos after the model call, because it did not know the licences "CC BY 3.0" and "Public domain". The script now knows them.
