# HereOut

HereOut reads a photo of a posted evacuation plan and shows the way out. The user takes a photo of the plan. HereOut finds the "you are here" mark and the exits, finds a route that stays inside the walls, and gives turn-by-turn steps. It is the owner's entry for the Meta Global AI Developer Hackathon (2026-10-26 to 2026-11-04 ET).

`AGENTS.md` is a symlink to this file. Also read the hub `CLAUDE.md`.

## Stack

- Python 3, FastAPI, OpenCV, numpy. No GPU: the models run through the Meta Model API.
- Muse Spark reads the plan. SAM 3.1 segments marks when it helps.

## Rules

- All code in this repository is written during the hackathon. Never copy code from another repository.
- Use Standard mode models only. Never call a `-contributor` model: those send the content to model training.
- Every model call goes through one client with a spend cap. A spend-limit notice from Meta does not stop billing.
- The API key lives in `.env` (gitignored) and on the server only. Never commit it.
- Never commit photos of plans. Test photos stay outside the repository.
- Requests to outside services never carry the owner's email address, also not in a User-Agent.
- Commit messages end with `Product: hereout`. They carry no AI attribution lines.

## Wiki

Decisions, components and history go to `wiki/` (STE-lite English). Record with `/wiki:ingest`.
