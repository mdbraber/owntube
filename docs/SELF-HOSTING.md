# Self-Hosting

OwnTube runs as two services: the **web app** (`apps/web`, port 3000) and its
**YouTube gateway** (`apps/gateway`, port 8080). The gateway is the only part
that talks to YouTube: catalogue data (`/api/*`, called by the web app) and
media (`/media/*`: streams, manifests, images). No Invidious, Piped, companion
or Postgres is needed.

```
browser / TV ──► app :3000 ──► gateway :8080 ──► YouTube
                     └─ /media/* forwarded (or routed by your reverse proxy)
```

- [Docker Compose](#docker-compose)
- [Unraid](#unraid)
- [Reverse proxy](#reverse-proxy) · [Network](#network)
- [Settings](#settings): [gateway](#gateway), [cache warmer](#cache-warmer)
- [Backups](#backups) · [Updating](#updating)
- [Upgrading from the Invidious setup](#upgrading-from-the-invidious-setup)
- [Troubleshooting](#troubleshooting)

---

## Docker Compose

Write a `.env` next to `docker-compose.yml` with two secrets, each its own
value:

```bash
cat > .env <<EOF
AUTH_SECRET=$(openssl rand -base64 48)
GATEWAY_SIGNING_KEY=$(openssl rand -base64 48)
EOF
docker compose up -d --build
```

- `AUTH_SECRET` signs sessions and TV pairings. `GATEWAY_SIGNING_KEY` (at
  least 32 characters) is shared by app and gateway: the gateway's API key and
  the signature on playback URLs. Both containers refuse to start while either
  is missing or still a placeholder from an example file.
- **`.env` only fills in the variables `docker-compose.yml` lists.** Every
  setting in this guide is listed there; to set anything else, add it to the
  service's `environment:` as well.
- SQLite (accounts, history, subscriptions, settings) lives in the named volume
  `owntube-data`; the gateway's caches in `owntube-gateway`.
- Migrations run on every app start.
- The app waits for the gateway's health check before it starts.
- The gateway has no published port. Without a reverse proxy the web app
  forwards `/media/*` to it.

---

## Unraid

`docker-compose.unraid.yml` runs the same two containers, `owntube` and
`owntube-gateway`, with their data under appdata instead of named volumes.

1. **Folders.** The gateway runs as uid 1000 (`node`) and must be able to
   write its cache:

   ```bash
   mkdir -p /mnt/user/appdata/owntube/data /mnt/user/appdata/owntube/gateway
   chown 1000:1000 /mnt/user/appdata/owntube/gateway
   ```

2. **Environment.** From the repo root:

   ```bash
   cp apps/web/env.unraid.example .env.unraid
   ```

   Set at least `AUTH_SECRET` and `GATEWAY_SIGNING_KEY` (each
   `openssl rand -base64 48`), `AUTH_URL` (the URL browsers use, e.g.
   `http://192.168.1.11:3000`) and `AUTH_TRUST_HOST=true`. As with `.env`
   above, only variables listed in `docker-compose.unraid.yml` reach the
   containers.

3. **Start:**

   ```bash
   docker compose -f docker-compose.unraid.yml --env-file .env.unraid up -d --build
   ```

   The app listens on port 3000. Logs:
   `docker compose -f docker-compose.unraid.yml --env-file .env.unraid logs -f app gateway`.

SQLite lives in `/mnt/user/appdata/owntube/data` (back this up); the gateway
folder only holds caches. For a reverse proxy on Unraid (Nginx Proxy Manager,
Traefik, …) see below: the gateway is only reachable from the same Docker
network, so a proxy outside it sends everything to port 3000.

---

## Reverse proxy

Put OwnTube behind TLS (Caddy, nginx, Traefik, Nginx Proxy Manager, …). Send
everything to the app (port 3000). To take media load off the app, route
`/media/*` straight to the gateway (port 8080); that needs the proxy on the
same Docker network as the gateway, since the gateway publishes no port. Caddy:

```caddy
owntube.example.org {
	reverse_proxy /media/* gateway:8080
	reverse_proxy app:3000
}
```

Never publish port 8080 to the internet: media URLs are signed with
`GATEWAY_SIGNING_KEY`, but the rest of the gateway is for the app only.

## Network

YouTube flags whole IPv6 /64s faster than single IPv4 addresses, so both
compose files set `GATEWAY_EGRESS_FAMILY=ipv4`. The host needs an IPv4 address
YouTube does not block.

---

## Settings

Set these in `.env` (or `.env.unraid`); both compose files pass them through.
Unset or empty means the default.

### Gateway

| Variable | Default | Role |
|----------|---------|------|
| `GATEWAY_SIGNING_KEY` | — (required, ≥ 32 chars) | API key and playback URL signatures; same value in the app |
| `GATEWAY_EGRESS_FAMILY` | `auto` (compose: `ipv4`) | `ipv4`, `ipv6` or `auto` |
| `GATEWAY_TRANSPORT` | `auto` | `sabr` to skip byte ranges when YouTube refuses them |
| `GATEWAY_PROXY_URL` | — | Outbound proxy for all YouTube traffic |
| `GATEWAY_IMAGE_CACHE_MAX_BYTES` | 1 GiB | Image cache size kept by the hourly prune |
| `GATEWAY_PO_BROWSER` | — | Chromium path for PO tokens; needs an image built with `--build-arg WITH_PO_BROWSER=true` |
| `GATEWAY_PLAYBACK_TTL_SEC` | `21600` (6 h) | Set on the **app**: how long a signed playback URL stays valid |

The compose files fix `GATEWAY_CACHE_DIR=/data/cache` inside the container.

### Cache warmer

The warmer runs **inside the app** (there is no `cache-warmer` sidecar any
more): 30 s after start and then every `OWNTUBE_WARM_INTERVAL_SEC` it
refreshes what pages read from cache: the Live and Shorts shelves, subscribed
and recently watched channels (RSS, first page, metadata), the likely-next
videos, then every user's home feed.

| Variable | Default | Role |
|----------|---------|------|
| `OWNTUBE_WARM_INTERVAL_SEC` | `900` | Seconds between runs; `0` disables the warmer |
| `OWNTUBE_WARM_REGION` | `US` | Trending / Shorts region |
| `OWNTUBE_WARM_LIMIT` | `48` | Trending video count (max 200) |
| `OWNTUBE_WARM_SHORTS` | `true` | Warm the home Shorts shelf |
| `OWNTUBE_WARM_CHANNELS` | `true` | Refresh channel metadata |
| `OWNTUBE_WARM_CHANNEL_PAGES` | `true` | Warm channel video lists |
| `OWNTUBE_WARM_RSS` | `true` | Refresh subscribed channels' RSS |
| `OWNTUBE_WARM_RECENCY` | `true` | Refresh channels' latest-upload times |
| `OWNTUBE_WARM_VIDEOS` | `true` | Warm likely-next videos (newest uploads, queue) |
| `OWNTUBE_WARM_VIDEO_LIMIT` | `5` | Newest uploads warmed per cycle (max 64), on top of the queue |
| `OWNTUBE_WARM_HOME` | `true` | Rebuild every user's home feed |
| `OWNTUBE_WARM_HISTORY_CHANNELS` | `32` | Max recently watched channels (max 128) |
| `OWNTUBE_WARM_SUBSCRIPTION_CHANNELS` | `64` | Max subscribed channels, most recent first (max 256) |

One-shot warm, e.g. after a deploy:

```bash
docker compose exec app pnpm warm:cache      # Unraid: docker exec owntube pnpm warm:cache
```

---

## Backups

`owntube.db` is the source of truth for accounts, history, interactions,
subscriptions and settings. It runs in WAL mode, so copy it with the app
stopped (or copy `owntube.db`, `owntube.db-wal` and `owntube.db-shm`
together):

```bash
docker compose stop app
docker compose run --rm --no-deps -v "$PWD/backups:/backup" app \
  tar czf "/backup/owntube-data-$(date +%F).tgz" -C /app/apps/web/data .
docker compose start app
```

On Unraid, stop `owntube` and copy `/mnt/user/appdata/owntube/data`. The
gateway's data only holds caches and needs no backup.

## Updating

```bash
git pull
docker compose up -d --build --remove-orphans
# Unraid:
docker compose -f docker-compose.unraid.yml --env-file .env.unraid up -d --build --remove-orphans
```

---

## Upgrading from the Invidious setup

Before the gateway (November 2026), OwnTube ran next to Invidious, its
companion, Postgres and a `cache-warmer` sidecar. To move over:

1. **Back up** the app's data (see [Backups](#backups)) and keep a copy of
   your old compose file and env file.
2. **Env file:** keep `AUTH_SECRET` unchanged (a new one signs everyone out
   and unpairs every TV). Add `GATEWAY_SIGNING_KEY`
   (`openssl rand -base64 48`). Remove `INVIDIOUS_*`, `PIPED_*`,
   `UPSTREAM_RATE_LIMIT_*` and `APP_BASE_URL`; they are no longer read.
3. **Compose:** take the current compose file (app + gateway, same data
   volume or folder). On Unraid, create the gateway folder first
   ([Unraid](#unraid), step 1). Start it with `--remove-orphans` (see
   [Updating](#updating)), which also removes the old `cache-warmer`
   container.
4. **TV app:** install **0.5.0 or later** at the same time; 0.4.x does not
   work with the gateway server. A build signed with the same key installs
   over the old one and keeps its sign-in.
5. **Invidious:** stop the Invidious stack (and any scheduled restarts for
   it). Keep its volumes until you are sure you will not roll back.

Rolling back: restore the old compose file, env file and backed-up data,
start Invidious again and reinstall a 0.4.x TV build.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `docker compose` stops with `set GATEWAY_SIGNING_KEY in .env` | Secret missing from `.env` | Add it (see [Docker Compose](#docker-compose)) |
| App or gateway exits with "still the example placeholder" | A secret was copied from an example file | `openssl rand -base64 48`; the same `GATEWAY_SIGNING_KEY` for both |
| Gateway exits with `GATEWAY_SIGNING_KEY must be at least 32 characters` | Key too short | `openssl rand -base64 48` |
| Gateway exits with `EACCES` on `/data/cache` | Bind mount not writable for uid 1000 | `chown 1000:1000` the host directory, or use a named volume |
| App never starts, gateway `unhealthy` | The app waits for the gateway's health check | `docker compose logs gateway` |
| A setting in `.env` has no effect | The compose file does not list it | Add it to the service's `environment:`, then `up -d` |
| Videos fail with bot checks / "Sign in to confirm" | YouTube flags the egress address | Keep `GATEWAY_EGRESS_FAMILY=ipv4`; try `GATEWAY_PROXY_URL` or another IPv4 address |
| Images or playback broken behind a proxy | `/media/*` routed somewhere that cannot reach the gateway | Route `/media/*` to `gateway:8080` on the same Docker network, or send it to the app |
| TV app shows errors after the upgrade | TV 0.4.x against the gateway server | Install TV 0.5.0+ |
| Everyone signed out after the upgrade | `AUTH_SECRET` changed | Restore the old value |
