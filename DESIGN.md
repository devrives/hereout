---
version: alpha
name: hereout
description: One page that reads a photo of an evacuation plan. A pale green ground, the logo's deep green, a blue route and green exit marks on the plan.
colors:
  # Light. Each name is the CSS custom property in src/hereout/web/style.css without "--".
  bg: "#f3f5f2"
  card: "#ffffff"
  fg: "#10201a"
  muted: "#55625b"
  accent: "#0b7a4b"
  accent-fg: "#ffffff"
  line: "#d5ddd8"
  soft: "#e4e9e5"
  logo-wall: "#173a31"
  logo-route: "#0e9f6e"
  logo-dot: "#f0563a"
  exit: "#0a7d3b"
  route: "#1b5fd1"
  # Fixed colours with no custom property (literal in style.css and app.js, the same in dark mode).
  step-lit: "#d9480f"
  reading: "#6a1b9a"
  reading-dropped: "#5f6368"
  # Dark (prefers-color-scheme: dark): the same names with "-dark". "exit" has no dark value.
  bg-dark: "#0e1a16"
  card-dark: "#15231e"
  fg-dark: "#eef4f0"
  muted-dark: "#a9b8b0"
  accent-dark: "#3ddc97"
  accent-fg-dark: "#06210f"
  line-dark: "#2b3b34"
  soft-dark: "#22312b"
  logo-wall-dark: "#8faaa0"
  logo-route-dark: "#3ddc97"
  logo-dot-dark: "#ff7a59"
  route-dark: "#6f9cf0"
typography:
  # The start heading has two steps (a width media query at 960 px): the wide step and its "-min" phone step.
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 3.1rem
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: -0.03em
  display-min:
    fontFamily: Plus Jakarta Sans
    fontSize: 2.1rem
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: -0.03em
  wordmark:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.45rem
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.03em
  badge:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.6rem
    fontWeight: 800
    lineHeight: 1.5
  answer-name:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.3rem
    fontWeight: 700
    lineHeight: 1.25
  h2:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.2rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  h3:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  lead:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.15rem
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.9rem
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.85rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.5
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.1rem
    fontWeight: 600
    lineHeight: 1.5
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.95rem
    fontWeight: 600
    lineHeight: 1.5
  label-seg:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.85rem
    fontWeight: 600
    lineHeight: 1.15
  exit-number:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.1rem
    fontWeight: 700
    lineHeight: 1.5
  kicker:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8rem
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: 0.05em
rounded:
  # style.css has no radius properties: these are the values the rules use.
  swatch: 3px
  focus: 4px
  sm: 8px
  seg-item: 9px
  field: 10px
  md: 12px
  lg: 14px
  xl: 16px
spacing:
  # style.css has no space properties: these are the values the rules use.
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 28px
  section: 40px
  wide-gap: 56px
  gutter: 16px
  gutter-wide: 48px
  page-max: 1200px
  answer-col: 380px
  tap: 44px
  button: 48px
  shoot: 60px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 10px 18px
  button-shoot:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    height: 60px
  button-new-photo:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 8px 14px
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 10px 18px
  seg:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.md}"
    padding: 4px
  seg-item:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.muted}"
    typography: "{typography.label-seg}"
    rounded: "{rounded.seg-item}"
    height: 44px
  seg-item-selected:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
  select:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    height: 44px
    padding: 6px 10px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.xl}"
    padding: 18px
  badge-exit:
    backgroundColor: "{colors.exit}"
    textColor: "#ffffff"
    typography: "{typography.badge}"
    rounded: "{rounded.sm}"
    height: 52px
  button-exit:
    backgroundColor: "{colors.exit}"
    textColor: "#ffffff"
    typography: "{typography.exit-number}"
    rounded: "{rounded.sm}"
    height: 44px
  button-exit-dead:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
  button-step:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 8px 12px
---
<!-- design-md: tokens=src/hereout/web/style.css -->

# HereOut

This file holds the tokens and the short design rules of the HereOut page (hereout.devrives.com). The code reads the colours from the custom properties at the top of `src/hereout/web/style.css`. The marks on the plan are drawn on a canvas by `src/hereout/web/app.js`, with their own constants (`ROUTE`, `WALL`, `WAY`, `NEAR`, `FAR_C`). Why the page has its layout: `wiki/decisions/page-layout-a.md`. The rules for every devrives product are in the kit skill `core:design-foundation` (`references/house-ui-rules.md`).

Check this file after each token change: `node kit/plugins/core/scripts/ui-review/design-md.mjs hereout/DESIGN.md` (from the hub). With `--fix`, it copies the CSS values into the tokens.

## Overview

One page (`src/hereout/web/index.html`), English on the start page, with a plan card in 13 languages. The user photographs a posted evacuation plan, taps where they stand, and sees a route to the nearest exit with turn-by-turn steps.

The page has two modes. The start page shows a heading, one lead line, the big photo button, an example plan, three short steps and the samples. With a plan open (class `has-plan` on `html`), the start text goes, the header gets a "New photo" button, and the plan stands beside its answer.

The look comes from the logo (direction A, owner, 2026-10-30): a pale green ground, the deep green of the logo for the action, and the font of the word mark. The plan itself is the picture: everything else is quiet around it.

## Colors

- `bg` is the pale green ground. `card` is the white of the cards, the buttons and the plan frame. `soft` is the track of the segmented control, the step numbers and the image placeholders.
- `accent` (the logo's deep green) is the colour of the action: the photo buttons, the "Show the plan of your photo" button, the selected sample ring, the bottom bar of the selected view button, and the progress bar.
- `logo-wall`, `logo-route` and `logo-dot` colour the three parts of the logo SVG. The word mark is `fg` with "Out" in `accent`.
- `exit` and `route` are the plan colours, also on the page: the exit badge and the exit buttons are `exit` with white numbers, and the ring around the chosen exit button is `route`. The canvas uses the same values in `app.js`. `exit` has no dark value, because the exit marks sit on the paper of the plan.
- The legend swatches sit on white, as the marks sit on the paper of the plan. Their colours are fixed in the swatch rules: the field (green to yellow), the ways out (`rgb(6, 64, 34)`), the walls (`#7a818b`), the exits and the route.
- The reading view (what Muse Spark read) has its own colours, fixed in the rules: `reading` (purple) for the model's floor box and exit points (`#c58af0` on the pressed button in dark mode), `reading-dropped` (grey) for a point that was not used, and red `#b3261e` for the dashed point HereOut did not use.
- The step that the user taps is `step-lit` (orange): a bar at the start of the step button, and the same part of the route on the plan.
- `step-lit`, `reading` and `reading-dropped` are not custom properties. The rules, `app.js` and `reading.js` write the values, so a change goes into each place.
- Dark mode redefines the custom properties under `prefers-color-scheme: dark`. The `-dark` tokens mirror them. The page sets `color-scheme: light dark` and a `theme-color` for each scheme.

## Typography

- One family: Plus Jakarta Sans, the font of the word mark. The page serves one variable file itself (`src/hereout/web/fonts/plus-jakarta-sans-latin.woff2`, weights 400 to 800, Latin only, SIL Open Font License) and preloads it. Other scripts (the plan card in Russian, Hindi, Arabic, Japanese and the others) fall back to `system-ui`.
- The body is 17 px, weight 400, line height 1.5. Buttons are weight 600.
- `display` is the one start heading (800). It is `display-min` (2.1rem) under 960 px.
- `h2` and `h3` are 700 with a small negative tracking. The answer card leads with `answer-name` beside the `badge` number.
- Small text has three steps: `body-sm` (0.9rem) for notes in cards, `caption` (0.85rem) for the legend and the credits, and `kicker` (0.8rem, capitals) for the kind of exit above its name.

## Layout

- One column on a phone, with a `gutter` of 16 px and the page width up to `page-max` (1200 px).
- At 600 px and wider, the view buttons and the larger-plan button share one row, and the larger-plan button shows its text.
- At 960 px and wider, the gutter is 48 px. The start page has two columns: the text at the left and the samples at the right (3 columns), with the demo video under both. With a plan open, the plan is at the left and the answer column (380 px) is at the right.
- On a phone the answer card comes first in the answer column, so the steps stay near the plan. The plan frame uses the full width of the screen under 600 px.
- While a plan reads or waits to open, the upload bar stays fixed at the foot of the screen. The body gets the same room (`--bar-room`, set by `app.js`).
- A touch target is at least `tap` (44 px). Buttons are 48 px high, the start photo button 60 px.

## Elevation & Depth

Flat. Cards and the plan frame have a 1 px `line` border and no shadow. Depth shows in only these places:

- the selected view button: a 1 px shadow and a 3 px inset bar in `accent`
- the chosen exit button: a ring in `card`, then a ring in `route`
- the selected sample: a 3 px ring in `accent`
- the second-look dialog: a backdrop of black at 60 %
- the fixed upload bar: a `line` border at its top

## Shapes

Rounded rectangles, from `swatch` (3 px) to `xl` (16 px). Buttons and the segmented track use `md` (12). The start photo button, the plan frame, the example, the video and the dialog use `lg` (14). Cards use `xl` (16). The exit badge, the exit buttons and the step icons use `sm` (8). The step numbers and the reading marks are circles (50 %). Under 600 px the plan frame has no radius.

## Components

All in `style.css` and `index.html`.

- Photo buttons (`button-shoot`, `button-new-photo`): a file input behind a label. They show only with JS.
- `button-primary` is the filled `accent` button: the photo buttons and "Show the plan of your photo". Every other button is `button-secondary` (white, a 1.5 px `line` border).
- The view control (`seg`, `seg-item`): "Escape map", "Photo only", "Routes only", with `aria-pressed`. Beside it, the larger-plan button (an icon, with text from 600 px).
- The plan frame (`.stage`) holds the canvas. The focus ring goes around the frame, not over the photo.
- The legend: one line for each mark, with a swatch on white.
- The answer card (`card`): the exit badge and name, the steps as buttons (`button-step`, numbered circles before them), the backup route, and the actions "Read the steps aloud" and "Mark the exit".
- The exit buttons (`button-exit`): the number only, as the mark on the plan. The full name is in the label. An exit with no way from the start is dashed (`button-exit-dead`).
- The language row: a globe icon, a label and a native `select`.
- Cards "What the plan says" (the plan words, each with its original under it) and "What Muse Spark read" (a pressed button shows the reading on the plan; the second look opens a `dialog`).
- The sample gallery: a grid of image buttons, with the selected one ringed.
- Icons: inline outline SVG, 24 viewBox, stroke 2, 20 px, `currentColor`.

## Do's and Don'ts

- Do keep the marks on the plan in their colours: the route blue, the exits green (owner, 2026-10-30).
- Do show each exit as its number, the same as its mark on the plan. Put the full name into the label.
- Do keep the start page in English. Only the plan card follows the language choice.
- Do put a focus ring (3 px, `fg`) on every control. On the canvas, put it around the frame.
- Do keep the live status line as a full sentence for a screen reader. While a route shows, the line is not visible.
- Do not let the start of the route come from the model: the start is the user's tap.
- Do not show the progress bar beside an open plan, or when the user asks for reduced motion. The note says it.

## House rule gaps

The current code differs from `references/house-ui-rules.md` in these places. They are recorded here, not fixed:

- The kind of exit ("Nearest exit") is a small capital label above the exit name (`.kicker`).
- The sample gallery uses a text button for more rows ("Show all N plans"), not a faded preview with a chevron.
- The section headings (`h2`, `h3`) have no icons.
- Buttons show a disabled state while a photo reads (opacity 0.55).
- The tapped step has a bar in `step-lit` at its start, and each plan word has a bar in `line` at its start.

## Screens

Widths: 390 and 1280. The page works in light and dark. Without JS, the start page shows one line that says HereOut needs JavaScript, and no photo button.

| Screen | Route | States |
|---|---|---|
| Start | `/` | first visit, no JS, light and dark |
| Samples | `/` (under the start text) | the first 8 (phone) or 9 (wide), all, credits open |
| Photo reading | `/` after a photo | reading (wait notes), ready to open, could not read, offline, a reload during the upload |
| Plan | `/?sample=<id>`, or a photo plan | no start yet, a route to the nearest exit, a tap off the floor, a chosen exit, a backup route, an exit with no way (dashed), a marked exit, larger plan, Photo only, Routes only |
| Plan language | `?lang=<tag>` | English, one of 12 more, Arabic (right to left), the plan words loading, no translation |
| Reading | `/?sample=<id>`, the reading card | the reading on the plan, the second look, the dialog of one sheet |
| Demo video | `/#demo` | the video, the transcript open |

Key screens: Start, Plan (a route to the nearest exit), Plan language (Arabic).
