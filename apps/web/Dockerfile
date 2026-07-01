# Build from the repo root (workspace context):
#   docker build -f apps/web/Dockerfile -t owntube .
# Run:  docker compose up

FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install only the web workspace (and its deps) from the root lockfile.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web apps/web

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
RUN pnpm run build

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/apps/web/data/owntube.db

RUN mkdir -p /app/apps/web/data

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["sh", "-c", "pnpm exec tsx scripts/migrate.ts && pnpm run start"]
