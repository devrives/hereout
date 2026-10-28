# HereOut

HereOut reads a photo of a posted evacuation plan and shows the way out. The user takes a photo of the plan. HereOut finds the exits with the model. The user taps where they stand: the start does not come from the model. HereOut then finds a route that stays inside the walls and gives turn-by-turn steps. It is the owner's entry for the Meta Global AI Developer Hackathon (2026-10-26 to 2026-11-04 ET).

`AGENTS.md` is a symlink to this file. Also read the hub `CLAUDE.md`.

## Stack

- Python 3, FastAPI, OpenCV, numpy. No GPU: the models run through the Baseten Model API.
- Muse Spark reads the plan. SAM 3.1 segments marks when it helps.
- Code: `src/hereout/`. How the parts fit: `wiki/components/plan-reader.md`.

## Commands

- Set up: `uv sync`
- Test: `uv run pytest -q`
- Run local: `uv run --env-file .env uvicorn hereout.app:app --port 8000`
- Try photos with the model: `uv run --env-file .env python scripts/try_photos.py <photo>...`. It writes to `out/` (gitignored). `--cached` uses the last reading again and makes no model call.

## Deployment

- `docker compose build hereout && docker compose up -d hereout`, then `curl -sI https://hereout.devrives.com/`.
- The container reads `.env` for the key. The spend ledger is on the volume `hereout-spend` (`/data/spend.json`). Read it with `docker exec hereout cat /data/spend.json`.
- The Baseten credit is 100 USD (owner, 2026-10-27). The caps share it: 60 USD for the server (`HEREOUT_SPEND_CAP_USD` in `docker-compose.yml`) and 30 USD for local tests (`HEREOUT_SPEND_CAP_USD` in `.env`). Keep the sum below the credit, because each ledger has its own cap.

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
