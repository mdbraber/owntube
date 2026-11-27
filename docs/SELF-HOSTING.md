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

---

## Docker Compose

```bash
cp apps/web/.env.example .env      # or write .env by hand, see below
docker compose up -d --build
```

`.env` needs at least:

```dotenv
# openssl rand -base64 48  (each its own value)
AUTH_SECRET=...
GATEWAY_SIGNING_KEY=...            # at least 32 characters; shared by app and gateway
```

- SQLite (accounts, history, subscriptions, settings) lives in the named volume
  `owntube-data`; the gateway's caches in `owntube-gateway`.
- Migrations run on every app start.
- The gateway has no published port. Without a reverse proxy the web app
  forwards `/media/*` to it.

### Reverse proxy

Put OwnTube behind TLS (Caddy, nginx, Traefik, …). Route `/media/*` straight to
the gateway (port 8080) and everything else to the app (port 3000). Keep port
8080 off the internet otherwise: media URLs are signed with
`GATEWAY_SIGNING_KEY`, the rest of the gateway is for the app only.

### Network

YouTube flags whole IPv6 /64s faster than single IPv4 addresses, so the
compose files set `GATEWAY_EGRESS_FAMILY=ipv4`. The host needs an IPv4 address
YouTube does not block.

### Gateway settings

| Variable | Default | Role |
|----------|---------|------|
| `GATEWAY_SIGNING_KEY` | — (required, ≥ 32 chars) | API key and playback URL signatures; same value in the app |
| `GATEWAY_EGRESS_FAMILY` | `auto` (compose: `ipv4`) | `ipv4`, `ipv6` or `auto` |
| `GATEWAY_CACHE_DIR` | `data/cache` (compose: `/data/cache`) | Metadata, image and layout caches |
| `GATEWAY_IMAGE_CACHE_MAX_BYTES` | 1 GiB | Image cache size kept by the hourly prune |
| `GATEWAY_TRANSPORT` | `auto` | `sabr` to skip byte ranges when YouTube refuses them |
| `GATEWAY_PROXY_URL` | — | Outbound proxy for all YouTube traffic |
| `GATEWAY_PO_BROWSER` | — | Chromium path for PO tokens (image built with `--build-arg WITH_PO_BROWSER=true`) |

A bind mount instead of the named volume keeps the host's ownership: make it
writable for uid 1000 (`node`), or the gateway exits with `EACCES` on
`/data/cache`.

---

## Cache warmer

The warmer runs **inside the app** (there is no `cache-warmer` sidecar any
more): 30 s after start and then every `OWNTUBE_WARM_INTERVAL_SEC` it pre-fills
trending, Shorts, channel metadata and the first page of subscribed and
recently watched channels.

| Variable | Default | Role |
|----------|---------|------|
| `OWNTUBE_WARM_INTERVAL_SEC` | `900` | Seconds between runs; `0` disables the warmer |
| `OWNTUBE_WARM_REGION` | `US` | Trending / Shorts region |
| `OWNTUBE_WARM_LIMIT` | `48` | Trending video count |
| `OWNTUBE_WARM_CHANNELS` | `true` | Refresh channel metadata |
| `OWNTUBE_WARM_CHANNEL_PAGES` | `true` | Warm channel video lists |
| `OWNTUBE_WARM_SHORTS` | `true` | Warm the home Shorts shelf |
| `OWNTUBE_WARM_HISTORY_CHANNELS` | `32` | Max history channels to include |
| `OWNTUBE_WARM_SUBSCRIPTION_CHANNELS` | `64` | Max subscribed channels for metadata + page warms (recent first) |

One-shot warm, e.g. after a deploy:

```bash
docker compose exec app pnpm warm:cache
```

---

## Backups

`owntube.db` is the source of truth for accounts, history, interactions,
subscriptions and settings. It runs in WAL mode, so copy it with the app
stopped (or copy `owntube.db`, `owntube.db-wal` and `owntube.db-shm` together):

```bash
docker compose stop app
docker run --rm -v owntube-data:/data -v "$PWD/backups:/backup" alpine \
  tar czf "/backup/owntube-data-$(date +%F).tgz" -C /data .
docker compose start app
```

(Compose prefixes volume names with the project name, e.g.
`owntube_owntube-data`; `docker volume ls` shows the real one.)

The gateway volume only holds caches and needs no backup.

---

## Upgrading from the Invidious setup

Before the gateway (November 2026), OwnTube ran next to Invidious, its
companion, Postgres and a `cache-warmer` sidecar. To move over:

1. **Back up** the `owntube-data` volume (see above) and keep a copy of your
   old compose file.
2. **`.env`:** keep `AUTH_SECRET` unchanged (a new one signs everyone out and
   unpairs every TV). Add `GATEWAY_SIGNING_KEY` (`openssl rand -base64 48`).
   Remove `INVIDIOUS_*`, `PIPED_*` and `UPSTREAM_RATE_LIMIT_*`; they are no
   longer read.
3. **Compose:** take the current `docker-compose.yml` (app + gateway, same
   `owntube-data` volume) and start it with
   `docker compose up -d --remove-orphans`, which also removes the old
   `cache-warmer` container.
4. **TV app:** install **0.5.0 or later** at the same time. 0.4.x does not work
   with the gateway server. A build signed with the same key installs over the
   old one and keeps its sign-in.
5. **Invidious:** stop the Invidious stack (and any scheduled restarts for it).
   Keep its volumes until you are sure you will not roll back.

Rolling back: restore the old compose file and the backed-up volume, start
Invidious again and reinstall a 0.4.x TV build.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Gateway exits with `GATEWAY_SIGNING_KEY must be at least 32 characters` | Key missing or too short | `openssl rand -base64 48`, same value for app and gateway |
| Gateway exits with `EACCES` on `/data/cache` | Bind mount not writable for uid 1000 | `chown 1000:1000` the host directory, or use a named volume |
| App never starts, gateway `unhealthy` | The app waits for the gateway's health check | `docker compose logs gateway` |
| Videos fail with bot checks / "Sign in to confirm" | YouTube flags the egress address | Keep `GATEWAY_EGRESS_FAMILY=ipv4`; try `GATEWAY_PROXY_URL` or another IPv4 address |
| Images or playback broken behind a proxy | `/media/*` does not reach the gateway | Route `/media/*` to port 8080, or leave it to the app |
| TV app shows errors after the upgrade | TV 0.4.x against the gateway server | Install TV 0.5.0+ |
| Everyone signed out after the upgrade | `AUTH_SECRET` changed | Restore the old value |
