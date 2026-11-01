---
type: decision
title: Muse Spark reads the words on the plan and translates the plan view
status: accepted
updated: 2026-11-01
checked: 73ef54e
sources:
  - owner:2026-11-01
  - src/hereout/reader.py
  - src/hereout/translate.py
  - src/hereout/pipeline.py
  - src/hereout/app.py
  - src/hereout/web/i18n.js
  - src/hereout/web/route.js
  - scripts/read_text.py
  - scripts/translate_ui.py
  - docker-compose.yml
---
# Muse Spark reads the words on the plan and translates the plan view

## Context

- The second judge review (2026-11-01) gave Impact 4.0 of 10 and Use of Meta AI 6.0 of 10.
- The judge said: the pitch is a plan in a language that the user cannot read, but every output was English. The model only gave points and a box.
- The owner told the agent to do every item of the review with sub agents (2026-11-01). Paid calls for this item were part of that request.

## Decision

- A third Muse Spark call (`read_text` in `reader.py`) reads the words on the plan. It gives the language of the plan, the title, the legend entries and the printed instructions.
- Each item has the original text and an English text. The call gives 12 items at most and no positions. It leaves out the "you are here" entry, because the start comes only from the tap.
- For a new photo, the text call starts beside the main call on the same image. It adds no wait. When it fails, the plan opens without the words.
- A text-only call translates the plan words and the exit labels into the language of the user (`/api/text/<id>?lang=`). It gets the original and the English text of each item.
- Translations of gallery plans go to a disk cache (`HEREOUT_TEXT_CACHE`, on the spend volume). Words of a new photo stay in memory for 6 h, never on disk.
- The endpoint accepts only the supported languages. It allows 30 calls for each address in 10 minutes. English and cache hits make no call.
- The texts of the plan card are in a catalogue (`web/i18n.js`). `scripts/translate_ui.py` had Muse Spark translate it once for each language. The files are in `web/i18n/`.
- Languages: Spanish, French, German, Italian, Portuguese, Russian, Ukrainian, Japanese, Korean, Simplified Chinese, Hindi and Arabic. Arabic sets right to left on the result block.
- The parts of a step are bare direction words, and each sentence holds its verb. When the parts held whole commands, Korean and Japanese gave wrong particles.
- The language comes from the browser. A select in the plan card changes it, and the address keeps it (`lang=`). "Read the steps aloud" uses that language.
- A card "What the plan says" gives the language of the plan, the title, the instructions and the legend. Each translated item has its original text under it.
- The start page, the card "What Muse Spark read" and the photo credits stay English.

## Consequences

- The agent checked the output in Korean, Japanese, Spanish, German and Russian. It fixed problems through the prompt and the key notes only.
- The reviews found three more problems. The agent fixed them by hand: a doubled word in two Arabic steps, a wrong Korean particle after a number, and a Korean button text.
- An exit label in another script (for example "ВЫХОД") gets an English name from a text-only call. The plan words already have an English text, so they make no call.
- On a phone the answer card comes before the language row, so the steps stay near the plan (ux review).
- A text read cost 0.0068 USD and took 10 s on average in the agent test. A translation costs about 0.003 to 0.005 USD for each plan and language, once.
- `scripts/read_text.py` adds the words to the gallery items. The item content is part of the key of the saved answers, so `save_answers.py` runs after it.
- A test rebuilds the English steps of `route.js` from the catalogue on random steps. A new step form needs a catalogue key, or the test fails.
- After a server restart, a new photo has no words in memory. A change of language then shows the English words.
