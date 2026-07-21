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
# Shared workspace package the web app depends on (@owntube/brand-icon).
COPY packages/brand-icon/package.json packages/brand-icon/package.json
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/brand-icon packages/brand-icon
COPY apps/web apps/web

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so they
# must be declared ARG + re-exposed as ENV before `next build` runs — compose
# passing them via `args:` alone has no effect without this.
ARG NEXT_PUBLIC_INVIDIOUS_BASE_URL=""
ENV NEXT_PUBLIC_INVIDIOUS_BASE_URL=$NEXT_PUBLIC_INVIDIOUS_BASE_URL
ARG NEXT_PUBLIC_MEDIA_BASE_URL=""
ENV NEXT_PUBLIC_MEDIA_BASE_URL=$NEXT_PUBLIC_MEDIA_BASE_URL

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
