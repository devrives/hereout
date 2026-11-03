---
type: decision
title: Demo video on the start page
status: accepted
updated: 2026-11-03
checked: 39e19c7
sources:
  - owner:2026-11-01
  - src/hereout/app.py
  - src/hereout/web/index.html
  - docker-compose.yml
  - tests/test_app.py
---
# Demo video on the start page

## Context

- On 2026-11-01 the owner asked for the demo video on the start page, to check it there.
- The video is the draft for the hackathon form. The hub recorder makes it from the live site, with captions and no sound.
- The recorder writes WebM (VP8). Some phone browsers do not play WebM.

## Decision

- The page gives an H.264 MP4 file and a poster image. The video loads only when the user starts it (`preload="none"`).
- The files stay outside the repository, in `../_workspace/hereout-video/site`, on a read-only mount. A new draft replaces them with no new image of the container.
- The server gives the video URL with the size and the time of the file. Thus the edge gives a new file at a new URL.
- The server removes the video block when `demo.mp4` is missing. It also removes the block when the gallery has no credit for a plan photo in the video.
- The block comes after the samples. On a wide screen it fills the two columns, so the captions in the picture are large enough to read. A link under the lead text goes to it.
- On a phone, the samples stay near the top.
- The video shows the page at phone size (390 px, scale 2) in a phone outline in a 1920 px frame. Large captions stand beside it. The hub script `compose.mjs` makes the video from a page video with no captions.
- The block has the text of the captions and a short text of what each part shows. The video has no sound, and a screen reader cannot read the picture.
- The block gives the credit of each plan photo in the video. The gallery previews in the video have their credits in the gallery. Since 2026-11-03 the credits are in the disclosure, after the text of the video ([ui-detail-pass](ui-detail-pass.md)).
- The block goes away when a plan opens, and the page stops the video.

## Consequences

- A change of `app.py` changes the key of the saved gallery answers. After the deploy, `save_answers.py` must run again.
- The video shows the page of 2026-10-31. After a change of the page, the recorder must make a new video. A new video needs a new text of what it shows, and a new list of the plans in it (`data-samples`).
- Reviews: the ux review found that a hidden video played on under a plan, and that the captions were too small in one column. The a11y review asked for a name of the video, a clear focus ring and a text of what the video shows. The fixes are in the same change.
- The first video had its captions in the header of the page, at 18 px. On a phone they were about 5 px, and they hid the photo button. The owner asked for a new video (2026-11-01).
- The second judge review (2026-11-01) found blank and still frames, a small plan in a desktop frame and no view of the second look. The owner chose gallery samples only, with no shots of a real phone (2026-11-01).
- The third video (2026-11-01) is 2 min 22 s long and about 8 MB. It shows a Russian plan, the language change and the words of the plan. Then it shows the second look on a German plan, the code view, the exit scores and "Mark the exit". The video has no page loads.
- On 2026-11-01 the owner asked for a motion graphic in place of the screen video: one sample, with its route drawn slowly.
- The fourth video (1 min 19 s, about 4 MB) is a motion graphic of RU-commons_000338. `motion.mjs` in the hub takes the real result from the live page and draws it frame by frame.
- The route goes from the middle hall to the left exit door, the way the printed arrows point. The first render used a tap that went to a false exit, so it did not ship.
- The owner found that Exit 4 of the fourth video is no exit (2026-11-01). The owner asked for a more stylish video on the refined page, in the order exits, ways out, tap, route.
- The fifth video (51 s) records the real page after the [Afterglow redesign](afterglow-redesign.md), with RU-commons_000164. The hub script `film.mjs` drives the page clock with Playwright, so the reveal runs slowly. A camera moves over the page, and a caption band says what each part does.
- The fifth video records a local server with no model key, so it makes no model call. The Korean card needs no call. The plan words in Korean need a call, so the video does not show them.
