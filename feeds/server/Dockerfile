# Debian-slim (glibc) so better-sqlite3 uses its prebuilt binary — no toolchain.
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first for layer caching. No lockfile is committed (3 deps), so a
# plain install is fine; pin majors in package.json.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json server.ts store.ts render.ts ip-allow.ts notify-hub.ts websub.ts icon.png ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

# Runs the TypeScript directly via tsx (a runtime dependency).
CMD ["npx", "tsx", "server.ts"]
