---
version: alpha
name: hereout
description: Afterglow. One dark page that reads a photo of an evacuation plan. The photo is dimmed, the ways out glow green from the exits, the route is a light blue line.
colors:
  # Each name is the CSS custom property in src/hereout/web/style.css without "--". One scheme: dark.
  bg: "#07100c"
  card: "#0f1a15"
  raise: "#15231d"
  fg: "#eaf3ee"
  muted: "#a7b8b0"
  line: "#22332b"
  soft: "#18251f"
  accent: "#3dffa0"
  accent-fg: "#03140b"
  logo-wall: "#8faaa0"
  logo-route: "#3dffa0"
  logo-dot: "#ff7a59"
  exit: "#3dffa0"
  route: "#5aa2ff"
  lit: "#ff9a3d"
  done: "#5b6f86"
  reading: "#d29bff"
typography:
  display:
    fontFamily: Geist
    fontSize: 4.2rem
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: -0.045em
  display-min:
    fontFamily: Geist
    fontSize: 2.6rem
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: -0.045em
  wordmark:
    fontFamily: Geist
    fontSize: 1.4rem
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.04em
  h2:
    fontFamily: Geist
    fontSize: 1.6rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.03em
  h3:
    fontFamily: Geist
    fontSize: 1.05rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.02em
  answer-name:
    fontFamily: Geist
    fontSize: 1.35rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.025em
  lead:
    fontFamily: Geist
    fontSize: 1.25rem
    fontWeight: 450
    lineHeight: 1.55
  body:
    fontFamily: Geist
    fontSize: 17px
    fontWeight: 450
    lineHeight: 1.55
  body-sm:
    fontFamily: Geist
    fontSize: 0.9rem
    fontWeight: 450
    lineHeight: 1.55
  caption:
    fontFamily: Geist
    fontSize: 0.85rem
    fontWeight: 450
    lineHeight: 1.55
  label:
    fontFamily: Geist
    fontSize: 17px
    fontWeight: 550
    lineHeight: 1.5
  label-strong:
    fontFamily: Geist
    fontSize: 1.1rem
    fontWeight: 650
    lineHeight: 1.5
  number:
    fontFamily: Geist Mono
    fontSize: 1.1rem
    fontWeight: 700
    lineHeight: 1
  badge:
    fontFamily: Geist Mono
    fontSize: 1.6rem
    fontWeight: 700
    lineHeight: 1
  mono-label:
    fontFamily: Geist Mono
    fontSize: 0.85rem
    fontWeight: 500
    lineHeight: 1.2
rounded:
  # style.css has no radius properties: these are the values the rules use.
  stage-chip: 10px
  exit: 12px
  sample: 14px
  card: 22px
  pill: 999px
spacing:
  # style.css has no space properties: these are the values the rules use.
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 28px
  section: 48px
  wide-section: 56px
  gutter: 16px
  gutter-wide: 48px
  page-max: 1200px
  answer-col: 390px
  tap: 44px
  button: 48px
  shoot: 60px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.pill}"
    height: 60px
    padding: 0 32px
  button-new-photo:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 44px
    padding: 8px 16px
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 48px
    padding: 10px 20px
  seg:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.pill}"
    padding: 4px
  seg-item:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.pill}"
    height: 40px
  seg-item-selected:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.bg}"
  stage-chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
    typography: "{typography.mono-label}"
    rounded: "{rounded.stage-chip}"
    height: 36px
  stage-chip-now:
    backgroundColor: "{colors.card}"
    textColor: "{colors.accent}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: 20px
  badge-exit:
    backgroundColor: "{colors.exit}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.badge}"
    rounded: "{rounded.sample}"
    height: 52px
  button-exit:
    backgroundColor: "{colors.exit}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.number}"
    rounded: "{rounded.exit}"
    height: 46px
  button-exit-dead:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
  button-step:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.stage-chip}"
    height: 48px
  button-step-lit:
    backgroundColor: "{colors.raise}"
    textColor: "#ffffff"
  now-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: 12px
  button-now-step:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.fg}"
    rounded: 18px
    height: 64px
    width: 56px
  badge-now:
    backgroundColor: "{colors.exit}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.exit}"
    height: 40px
---
<!-- design-md: tokens=src/hereout/web/style.css -->

# HereOut

This file holds the tokens and the design rules of the HereOut page (hereout.devrives.com). The direction is Afterglow (owner, 2026-11-01). The code reads the colours from the custom properties at the top of `src/hereout/web/style.css`. The marks on the plan are drawn on a canvas by `src/hereout/web/app.js`, with constants of the same values (`EXIT`, `ROUTE`, `LIT`, `WAY`, `DARK`, `VEIL`). The rules for every devrives product are in the kit skill `core:design-foundation` (`references/house-ui-rules.md`).

Check this file after each token change: `node kit/plugins/core/scripts/ui-review/design-md.mjs hereout/DESIGN.md` (from the hub). With `--fix`, it copies the CSS values into the tokens.

## Overview

One page (`src/hereout/web/index.html`), English on the start page, with a plan card in 13 languages. The user photographs a posted evacuation plan, taps where they stand, and sees a route to the nearest exit with turn-by-turn steps.

The concept is a dark corridor in an emergency: the paper plan is dimmed, and the ways out glow like the green lines of emergency lighting. The reference is photoluminescent egress marking and dark product interfaces (Linear). The owner picked this direction from three (sign, afterglow, transit) on 2026-11-01.

The page has two modes. The start page shows the heading, the photo button, a hero plan (a sample, dimmed, with its ways out and a route), the four parts of the work, the samples and the demo video. With a plan open (class `has-plan` on `html`), the start text goes, the header gets a "New photo" button, and the plan stands beside its answer.

A plan opens in the order of the work (owner, 2026-11-01): the exits one by one, then every way out, then the tap, then the route. The strip "Exits, Ways out, You, Route" above the plan lights the part that shows now.

## Colors

- `bg` is the dark ground of the page. `card` is the ground of the cards, the buttons and the controls. `raise` is a button under the pointer and the lit step. `line` is every border.
- `accent` is the glow green: the photo buttons, the links, the stage that shows now, and the "Out" of the word mark. It is the one brand colour. Text on it is `accent-fg`.
- `exit` is the same glow green: the exit marks on the plan, the exit badge and the exit buttons, with dark numbers.
- `route` is the light blue of the route on the plan, the step numbers and the ring round the chosen exit.
- `lit` (amber) is the current step: its number, its turn icon and its part of the route on the plan. On the last step it is a ring round the exit.
- `done` (grey blue) is the part of the route before the current step, and the numbers of those steps on the plan.
- `reading` is the purple of the reading view (what Muse Spark read). That view shows the whole photo, not dimmed, with its own fixed colours in `reading.js`.
- `logo-wall`, `logo-route` and `logo-dot` colour the three parts of the logo SVG.
- The page has one scheme (`color-scheme: dark`). The photo is the only light area, and in the escape map it is under a veil (`VEIL`, the ground at 60 %).

## Typography

- Geist for text and Geist Mono for numbers (exit numbers, step numbers, the stage strip, the sample countries). The page serves both variable files itself (`src/hereout/web/fonts/`, Latin only, SIL Open Font License) and preloads Geist. Other scripts (the plan card in Russian, Hindi, Arabic, Japanese and the others) fall back to `system-ui`.
- The body is 17 px at weight 450. Buttons are 550, the photo buttons 650, headings 600 with negative tracking. No 400 text on the dark ground: it looks thin.
- `display` is the one start heading. It is `display-min` under 960 px. The words "way out" are in `accent`.

## Layout

- One column on a phone, with a `gutter` of 16 px and the page width up to `page-max` (1200 px).
- At 960 px and wider, the gutter is 48 px. The start page has the text at the left and the hero plan at the right. The four parts, the samples (6 columns) and the demo video are full width under them. With a plan open, the plan is at the left and the answer column (390 px) is at the right.
- On a phone the answer card comes first in the answer column, so the steps stay near the plan. The plan frame uses the full width of the screen under 600 px.
- After a tap, the card of the current step is right under the plan, in view with it (research brief 2026-11-01: on a phone the steps were below the fold). The page scrolls only as far as the card needs, and the top of the plan stays in view. While its place is below the screen, the card sticks to the foot of the screen. Under 600 px it uses the full width, as the plan does.
- While a plan reads or waits to open, the upload bar stays fixed at the foot of the screen. The body gets the same room (`--bar-room`, set by `app.js`).
- A touch target is at least `tap` (44 px). Buttons are 48 px high, the start photo button 60 px.

## Elevation & Depth

Flat, with light in place of shadow. Cards, controls and the plan frame have a 1 px `line` border. Depth shows in only these places:

- the glow of the start photo button, the exit badge and the exit marks on the plan
- the glow under the route and the ways out on the plan
- the selected view button: `fg` ground with `bg` text
- the chosen exit button: a ring in `card`, then a ring in `route`
- the second-look dialog: a backdrop of black at 70 %

## Shapes

Round ends for every button, the view control and the language select (`pill`). Cards, the plan frame, the hero and the video use `card` (22 px). The exit badge and the samples use `sample` (14 px), the exit buttons `exit` (12 px), the stage strip `stage-chip` (10 px). The step numbers and YOU are circles. Under 600 px the plan frame has no radius.

## Components

All in `style.css` and `index.html`.

- Photo buttons (`button-primary`, `button-new-photo`): a file input behind a label. They show only with JS.
- `button-secondary` is every other button: `card` ground, a `line` border.
- The stage strip (`stage-chip`): four labels above the plan. Done parts have a green dot, the part that shows now is green with a green border (`stage-chip-now`).
- The view control (`seg`, `seg-item`): "Escape map", "Photo only", "Routes only", with `aria-pressed`. Beside it, the larger-plan button.
- The plan frame (`.stage`) holds the canvas. The focus ring goes around the frame, not over the photo.
- The legend: one line for each mark, with a swatch on the dark ground of the plan.
- The answer card (`card`): the exit badge and name, the steps as rows with a number circle (`button-step`, `button-step-lit`), the backup route, and the actions "Read the steps aloud" and "Mark the exit".
- The exit buttons (`button-exit`): the number, as the mark on the plan. The full name is in the label. The nearest exit and the exit of the second way also have a word beside the number ("Nearest", "If blocked"). The words stay when the user chooses another exit, so the buttons do not move. An exit with no way from the start is dashed (`button-exit-dead`).
- The current step (`now-card`, `badge-now`, `button-now-step`): under the plan after a tap. A small exit badge, "Exit 4 · Step 2 of 5", a speaker button that reads this step only, then the turn icon and the words of the step between a previous and a next button (56 × 64 px, the thumb zone). The plan lights the same step. At the first and the last step, the button that has nothing to show keeps its place but does not show, so the card does not move; the focus goes to the other button. Each step change goes once to the live line of the plan. The full list stays in the answer card.
- Turn icons: one outline glyph for each step, left of its words in the step list and in the card: straight, left, right, slight left, slight right, back, and an exit door for the last step. Step 1 names a side of the plan, so its arrow points to that side. 24 viewBox, stroke 2, `currentColor`: muted in the list, `lit` for the current step, `exit` for the door.
- On the plan: a small numbered dot where each step starts, the same number as in the list (step 1 starts at YOU and has none). The current step is `lit`, the legs and dots before it are `done`, the rest is `route`. A short white arrow at YOU points the first move.
- The samples: a grid of photos with the country under each one in Geist Mono. Under the first rows, one faded row and a round chevron button open the rest.
- Icons: inline outline SVG, 24 viewBox, stroke 1.8, 20 px, `currentColor`.

## Do's and Don'ts

- Do keep the marks on the plan in their colours: the route blue, the exits green (owner, 2026-10-30). On the dark page they are the light versions: `route` and `exit`.
- Do open a plan in the order of the work: exits, ways out, the tap, the route. A tap ends the reveal at once. With reduced motion, everything shows at once.
- Do keep the plan and the current step in view together after a tap, on a phone too.
- Do let a tap on the dashed second way, or on an exit mark, route to that exit, as its exit button does. A tap where the dashed line runs beside the route is a new start.
- Do dim the photo in the escape map. Do not dim it in "Photo only" or in the reading view.
- Do show each exit as its number, the same as its mark on the plan. Put the full name into the label.
- Do keep the start page in English. Only the plan card follows the language choice.
- Do put a focus ring (3 px, `fg`) on every control. On the canvas, put it around the frame.
- Do not let the start of the route come from the model: the start is the user's tap.
- Do not add a light scheme without a new decision: the glow needs the dark ground.

## House rule gaps

The current code differs from `references/house-ui-rules.md` in these places. They are recorded here, not fixed:

- The stage strip is a row of four states above the plan. The owner asked for the order of the work to show (2026-11-01).
- The section headings in the plan card (`h3`) have no icons.
- Buttons show a disabled state while a photo reads (opacity 0.55).
- The exit badge in the answer card and in the card of the current step shows the number that the text beside it also names ("4", "Exit 4"). The badge is the mark of the exit on the plan, so the eye finds it there.

## Screens

Widths: 390 and 1280. Without JS, the start page shows one line that says HereOut needs JavaScript, and no photo button.

| Screen | Route | States |
|---|---|---|
| Start | `/` | first visit, no JS |
| Samples | `/` (under the four parts) | the first rows and the faded row, all, credits open |
| Photo reading | `/` after a photo | reading (wait notes), ready to open, could not read, offline, a reload during the upload |
| Plan | `/?sample=<id>`, or a photo plan | the reveal (exits, ways out), waiting for the tap, a route draws in, the current step (first, middle, last), a tap off the floor, a chosen exit, a tap on the dashed second way, a backup route, an exit with no way (dashed), a marked exit, larger plan, Photo only, Routes only |
| Plan language | `?lang=<tag>` | English, one of 12 more, Arabic (right to left), the plan words loading, no translation |
| Reading | `/?sample=<id>`, the reading card | the reading on the plan, the second look, the dialog of one sheet |
| Demo video | `/#demo` | the video, the transcript open |

Key screens: Start, Plan (the reveal and a route to the nearest exit), Plan language (Arabic).
