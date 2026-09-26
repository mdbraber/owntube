# Debian-slim (glibc) so better-sqlite3 uses its prebuilt binary — no toolchain.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json server.ts hub.ts store.ts topic.ts safety.ts ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

CMD ["npx", "tsx", "server.ts"]
