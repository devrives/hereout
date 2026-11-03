---
type: decision
title: Hover and press feedback, and a calmer demo player
status: accepted
updated: 2026-11-03
checked: b5be710
sources:
  - owner:2026-11-03
  - src/hereout/web/app.js
  - src/hereout/web/style.css
  - src/hereout/web/index.html
  - src/hereout/app.py
  - tests/test_app.py
---
# Hover and press feedback, and a calmer demo player

## Context

- On 2026-11-03 the owner asked for small UI and UX changes. A click must show a hand cursor. The play of the demo video felt messy. The owner wanted proposals and mockups first.
- Checks of the live page found these problems:
  - Buttons and links already had a hand cursor. The plan had a cross cursor everywhere, also on a wall, where a click gives no start.
  - On a phone, a button gave no sign of a press.
  - The poster of the demo video was a frame from the middle of the film. The browser controls covered it before play.
  - Under the video, the photo credits were one long paragraph (19 lines at 390 px).
  - At 390 px the 16:9 film was so small that its captions were about 7 px high.
  - In the film, no tap was visible: the screen changed with no cause. A focus ring showed on a button. Each scroll was a jump. Some captions had no tag.
- The owner saw the mockup canvas and said to apply all of it (2026-11-03).

## Decision

- Plan, mouse only: on open floor the cursor is a hand, with a faint dot where the start goes. On a wall or off the plan it is "not-allowed". The check uses the same rules as a tap (`startFromTap`). Marking an exit keeps the cross. A click on the reading view goes back to the plan, so it shows a hand with no dot. A photo map or a plan with no exits shows no dot.
- The language menu has a hand cursor.
- A pressed button dips and gets an accent border. The browser's grey tap flash is off. The transitions run only with no request for reduced motion.
- The demo video has one play button over a title frame of the film. The browser controls come with the first play. Without the script, the video keeps its own controls.
- Under the video there is one short line: the length, "no sound, with captions", and a link to the photo credits. The credits are in the one disclosure, after the text of the video. The link opens the disclosure. The credit text of each photo did not change. Later (2026-11-03), the line kept only "No sound, with captions": see [Fewer repeated lines on the start page](start-page-trims.md).
- A screen under 600 px gets a 4:5 cut of the film (`demo-vertical.mp4`), with the captions under the phone, and its own poster. A wider screen gets the 16:9 film.
- When the 4:5 file is not in the video folder, the server removes its source, and the box of the player stays 16:9.
- The hub script `film.mjs` makes both cuts (`--vertical` for 4:5). In both:
  - a hand moves to each control and taps it, with a ring at the tap
  - scrolls glide, and a cut (a new plan, a dialog) fades over
  - no focus ring shows
  - the tag over a caption names who does the work, where one actor is true
  - the poster is the frame at 22 s, with the page title in place of the caption
  - no caption is on a photo. In the 16:9 story frame, the plan photo is at the right, and the words are at the left. The owner found the caption on the photo hard to read (2026-11-03).
  - at the end of the story, its words fade out first, and the next caption comes in after the photo fades out

## Consequences

- The UX review found these problems. The fixes are in the same change.
  - a 4:5 box with no 4:5 file
  - an arrow on the reading view
  - a focus ring after a mouse click on play
  - two marks of the start: the hover dot and the keyboard cross
  - a dot on a plan that gives no start on a click
- The copy review found that topic tags ("Steps", "Language") mixed with actor tags ("Muse Spark", "You"). Thus the tags name actors only, and two scenes have no tag.
- The accessibility review asked for the visible "0:56" in the name of the play button, and for a shorter description of the video. Both fixes are in the same change.
- This changes `app.py`, so `save_answers.py` must run after the deploy.
- The video folder has two more files: `demo-vertical.mp4` and `demo-vertical-poster.webp`. The text of the video names the taps of the hand.
- This supersedes the credit line under the video of [Demo video on the start page](demo-video.md).
