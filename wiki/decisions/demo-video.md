---
type: decision
title: Demo video on the start page
status: accepted
updated: 2026-11-01
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
- The block gives the credit of each plan photo in the video. The gallery previews in the video have their credits in the gallery.
- The block goes away when a plan opens, and the page stops the video.

## Consequences

- A change of `app.py` changes the key of the saved gallery answers. After the deploy, `save_answers.py` must run again.
- The video shows the page of 2026-10-31. After a change of the page, the recorder must make a new video. A new video needs a new text of what it shows, and a new list of the plans in it (`data-samples`).
- Reviews: the ux review found that a hidden video played on under a plan, and that the captions were too small in one column. The a11y review asked for a name of the video, a clear focus ring and a text of what the video shows. The fixes are in the same change.
- The first video had its captions in the header of the page, at 18 px. On a phone they were about 5 px, and they hid the photo button. The owner asked for a new video (2026-11-01).
- The second judge review (2026-11-01) found blank and still frames, a small plan in a desktop frame and no view of the second look. The owner chose gallery samples only, with no shots of a real phone (2026-11-01).
- The third video (2026-11-01) is 2 min 22 s long and about 8 MB. It shows a Russian plan, the language change and the words of the plan. Then it shows the second look on a German plan, the code view, the exit scores and "Mark the exit". The video has no page loads.
