# Build from the repo root (workspace context):
#   docker build -f apps/gateway/Dockerfile -t owntube-gateway .
# The gateway runs its TypeScript directly on Node's type stripping: no build step.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/gateway/package.json apps/gateway/package.json
RUN pnpm install --frozen-lockfile --prod --filter gateway...

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY tsconfig.node.json ./
COPY apps/gateway/src apps/gateway/src
USER node
WORKDIR /app/apps/gateway
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/main.ts"]
