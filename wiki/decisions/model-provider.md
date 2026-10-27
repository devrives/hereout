---
type: decision
title: Read plans with Muse Spark through Baseten
status: accepted
updated: 2026-10-27
sources:
  - owner:2026-10-27
  - src/hereout/reader.py
  - https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/baseten/model/muse-spark-open
---
# Read plans with Muse Spark through Baseten

## Context

- The owner got a Baseten API key for the hackathon on 2026-10-27.
- The key lists 20 models. Two are Meta models: `meta-models/muse-spark-open` and `meta-models/muse-spark-open-1026`.
- The Baseten API is compatible with the OpenAI chat API and accepts images.
- A test call on one plan photo gave the "you are here" point and the exit within 1 percent of the image size.

## Decision

- The plan reader uses `meta-models/muse-spark-open-1026` through `https://inference.baseten.co/v1/chat/completions`.
- All model calls go through `ModelClient` in `reader.py`. It reserves the worst-case cost before each call and refuses the call when the total can go above the cap. The cap is `HEREOUT_SPEND_CAP_USD` (default 5 USD).
- The ledger counts the worst-case cost when a call times out, because a call that times out can still be billed.
- The client refuses a model name that ends in `-contributor`.
- The key is the `BASETEN` value in `.env`. Git ignores this file.
- Both calls use low reasoning effort (`reasoning_effort: low`, `HEREOUT_EFFORT`). The owner asked for less time and cost on 2026-10-27.

## Consequences

- The default prices in the code are 1.25 USD for each million input tokens and 4.25 USD for each million output tokens. A third-party price list gave these values. The Baseten price page did not confirm them yet.
- Muse Spark reasons before it answers. In the test call, 1,063 of the 1,092 output tokens were reasoning. With a limit of 6,000 output tokens, one call in the six-photo test gave no JSON answer. The code now permits 12,000 output tokens and gives a clear error when the model uses all of them.
- In the first test with six plan photos, one photo cost 0.015 to 0.054 USD with two calls, and took 17 to 53 seconds.

## Reasoning effort

A test on 30 random gallery plans compared three settings with the saved readings (default effort, two calls):

| Setting | Median time | Median cost | "You are here" within 5 percent of the saved point |
|---|---|---|---|
| Default effort, two calls (saved) | 23.8 s | 0.0218 USD | (reference) |
| Low effort, one call | 9.1 s | 0.0065 USD | 22 of 30 |
| Low effort, two calls | 12.5 s | 0.0086 USD | 29 of 30 |

- For the 8 points that moved with one call, the saved point was on the mark in all 8 (check by eye). So the zoomed second call is necessary.
- The setting "low effort, two calls" is the default.
