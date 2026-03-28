# Multi-stage Python 3.12 image — build context: monorepo root (vecta/).

FROM python:3.12-slim AS builder
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/services/compliance-ai/requirements.txt .
RUN pip install --upgrade pip && \
    pip install --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runner
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 vecta && \
    useradd  --uid 1001 --gid vecta --shell /bin/sh vectauser

COPY --from=builder /install /usr/local
COPY --chown=vectauser:vecta backend/services/compliance-ai/src ./src

USER vectauser

EXPOSE 3007

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD /bin/sh -c 'curl -f "http://127.0.0.1:$${PORT:-3007}/health" || exit 1'

CMD ["/bin/sh", "-c", "exec uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-3007} --workers 2"]
