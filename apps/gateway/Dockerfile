# Build from the repo root (workspace context):
#   docker build -f apps/gateway/Dockerfile -t owntube-gateway .
# The gateway runs its TypeScript directly on Node's type stripping: no build step.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/youtube/package.json packages/youtube/package.json
COPY packages/playback/package.json packages/playback/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --prod --filter gateway...

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# The PO-token browser (third transport step) is left out unless asked for:
# docker build --build-arg WITH_PO_BROWSER=true … and set GATEWAY_PO_BROWSER=/usr/bin/chromium.
ARG WITH_PO_BROWSER=false
RUN if [ "$WITH_PO_BROWSER" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*; \
    fi
COPY --from=deps /app /app
COPY tsconfig.node.json ./
COPY packages/youtube/src packages/youtube/src
COPY packages/playback/src packages/playback/src
COPY packages/contracts/src packages/contracts/src
COPY apps/gateway/src apps/gateway/src
# Caches (metadata, images, progressive layouts) live here; a named volume
# mounted on it takes this ownership.
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/gateway
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/main.ts"]
