FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
# RapidOCR fetches its text models on first use, into its package folder.
# Fetch them at build time: the container user cannot write there.
RUN .venv/bin/python -c "from hereout.ink_walls import warm_text_models; warm_text_models()"

RUN useradd --uid 1000 --create-home hereout && mkdir /data && chown hereout /data
USER hereout
ENV PATH="/app/.venv/bin:$PATH" HEREOUT_LEDGER=/data/spend.json
EXPOSE 8000
CMD ["uvicorn", "hereout.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
