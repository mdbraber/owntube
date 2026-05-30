# Self-Hosting a Video Backend

OwnTube fetches video metadata and streams from either **Piped** or **Invidious**.
Public instances are frequently unreliable (rate-limits, 403s, downtime).
Running your own local instance solves all of this.

---

## Option A — Self-hosted Invidious (recommended, single command)

Invidious is a YouTube front-end that exposes a full REST API used by OwnTube
for search, video detail, and related videos.

### Prerequisites
- Docker + Docker Compose v2
- ~500 MB disk space for the PostgreSQL volume

### 1. Run the setup script

```bash
# From the OwnTube project root:
bash scripts/setup-invidious.sh
```

This clones the official Invidious repository into `../invidious/` (sibling of
OwnTube) for the Postgres init scripts, then starts **pre-built** images from
Quay (`docker-compose.owntube-local.yml`). Nothing is compiled on your machine,
so **Docker BuildKit is not required**.

First boot takes **1–3 minutes** while PostgreSQL initialises and Invidious runs
migrations. Watch the logs:

```bash
cd ../invidious && docker compose -f docker-compose.owntube-local.yml logs -f invidious
```

Wait until you see a line like:
```
Invidious 0.x.x (production) listening on 0.0.0.0:3000
```

Verify it's working:
```bash
curl -s http://localhost:3001/api/v1/stats | python3 -m json.tool | head
```

### 2. Update your `.env`

```dotenv
# Disable Piped (public instances are unreliable)
PIPED_BASE_URL=disabled

# Point to your local Invidious
INVIDIOUS_BASE_URL=http://localhost:3001
```

### 3. Restart OwnTube

```bash
pnpm dev
```

Search, thumbnails, and video playback should all work immediately.

### Stopping / restarting Invidious

```bash
cd ../invidious
docker compose -f docker-compose.owntube-local.yml down
docker compose -f docker-compose.owntube-local.yml up -d
```

---

## Option B — Self-hosted Piped

Piped is more complex (requires 3 services: backend, proxy, and optionally a
frontend), but provides HLS/DASH streams with better quality options.

### Prerequisites
- Docker + Docker Compose v2
- A publicly-accessible domain (Piped requires it for its proxy to work)

### Steps

Follow the official guide:
👉 <https://docs.piped.video/docs/self-hosting/>

Once running, set in your `.env`:

```dotenv
PIPED_BASE_URL=https://api.your-piped.example
# Keep Invidious as fallback:
INVIDIOUS_BASE_URL=http://localhost:3001
```

---

## Choosing a public instance (quickest option)

If you don't want to self-host, pick a working instance from these lists and
paste it in `.env`:

| Service   | Instance list |
|-----------|---------------|
| Piped     | <https://piped-instances.kavin.rocks/> |
| Invidious | <https://api.invidious.io/> |

Test before using:
```bash
# Test Piped
curl -s "https://YOUR-PIPED/streams/dQw4w9WgXcQ" | python3 -m json.tool | head -5

# Test Invidious
curl -s "https://YOUR-INVIDIOUS/api/v1/videos/dQw4w9WgXcQ" | python3 -m json.tool | head -5
```

Both should return valid JSON (not HTML, not 403).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Upstream rate limit reached for this process` | OwnTube’s **process** limiter (~60 req/min default) and both configured upstreams were throttled in the same request | Raise `UPSTREAM_RATE_LIMIT_MAX_REQUESTS`; with Piped + Invidious set, the second source is tried automatically before this error |
| Feed looks like regional trending | `PIPED_BASE_URL` points at the web UI, or Piped `/channel/…` returns no `relatedStreams` and Invidious was not configured as fallback | API on **8091** (not 8090); keep a working `INVIDIOUS_BASE_URL` for channel upload lists used by recommendations. OwnTube also tries Piped search + Invidious RSS when native channel video lists are empty or parse-error. |
| `Invalid JSON (upstream returned HTML)` on Piped | `PIPED_BASE_URL` points at the **frontend** (e.g. port 8090), not the API backend | Use the Piped **backend** URL from [self-hosting docs](https://docs.piped.video/docs/self-hosting/), or `PIPED_BASE_URL=disabled` and Invidious only |
| "Search temporarily unavailable" | Both Piped & Invidious unreachable | Check URLs, add `https://`, run setup script |
| Thumbnails 404 | Invidious URL missing protocol | Ensure `INVIDIOUS_BASE_URL` starts with `https://` or `http://` |
| "Could not load this video — HTTP 403" | Invidious instance blocks API | Switch to a different instance or self-host |
| "Could not load this video — HTTP 502" | Piped instance is down | Set `PIPED_BASE_URL=disabled` and use Invidious only |
| Playback or hover preview broken in Docker | Server builds media URLs with `Host: 0.0.0.0:3000` instead of the LAN URL you use in the browser | Set `APP_BASE_URL=http://192.168.1.14:3000` (your real OwnTube URL), rebuild/restart |
| `the --mount option requires BuildKit` | Old flow built Invidious from source | Run `bash scripts/setup-invidious.sh` again (uses pre-built images; no BuildKit) |
| Next logs `GET /api/v1/search … 404` while search fails | OwnTube and Invidious share the same host **port** (e.g. both on 3001). Server `fetch` hits Next itself. | Run Invidious on **3001** and OwnTube on **3000** (default `pnpm dev`), or change one of the ports. |
| Invidious / companion `Restarting`, logs: `invidious_companion_key` needs 16 characters | Companion secret must be **exactly 16 characters** | Re-run `bash scripts/setup-invidious.sh` from OwnTube (fixed generator), then `docker compose -f docker-compose.owntube-local.yml up -d` in the Invidious clone. |
| OwnTube watch: `Invalid JSON` / `empty body` / `Unexpected end of JSON input` | Invidious answered before **companion** was ready, or non-JSON error page | Re-run `bash scripts/setup-invidious.sh` (compose now waits for companion **healthy** before starting Invidious), then `docker compose ... down && up -d`. Wait ~20 s after `up` before testing. |
| Invidious first boot slow | DB migration running | Wait ~2 min, watch logs |

---

## Cache warmer (Docker)

`docker compose up` starts a **`cache-warmer`** sidecar that runs `pnpm warm:cache`
every 20 minutes (configurable). It pre-fills SQLite with:

- Regional **trending** (home feed)
- **Shorts** shelf candidates
- **Channel meta** (names + avatar URLs) for subscribed and recently watched channels
- **Channel video pages** (first page) for the same channels

The sidecar shares the `owntube-data` volume with the app and waits until the
app healthcheck passes before the first run.

```bash
# Follow warmer logs
docker compose logs -f cache-warmer

# One-shot warm (e.g. after deploy)
docker compose exec app pnpm warm:cache
```

Environment variables (also in `.env.example`):

| Variable | Default | Role |
|----------|---------|------|
| `OWNTUBE_WARM_INTERVAL_SEC` | `1200` | Sidecar sleep between runs |
| `OWNTUBE_WARM_REGION` | `US` | Trending / shorts region |
| `OWNTUBE_WARM_LIMIT` | `48` | Trending video count |
| `OWNTUBE_WARM_CHANNELS` | `true` | Refresh `channel_meta` |
| `OWNTUBE_WARM_CHANNEL_PAGES` | `true` | Warm channel video lists |
| `OWNTUBE_WARM_SHORTS` | `true` | Warm home Shorts shelf |
| `OWNTUBE_WARM_HISTORY_CHANNELS` | `32` | Max history channels to include |

To disable the sidecar, stop or remove the `cache-warmer` service from your
compose file, or run only the app: `docker compose up app`.

**Host cron (optional fallback)** — if you run OwnTube outside Docker or without
the sidecar:

```bash
# Every 20 minutes
*/20 * * * * cd /path/to/OwnTube && OWNTUBE_WARM_REGION=US pnpm warm:cache >> /var/log/owntube-warm.log 2>&1
```

`pnpm warm:feed` is an alias for `pnpm warm:cache`.

---

## Backups (recommended)

`owntube.db` is the source of truth for accounts, history, interactions,
subscriptions, and settings. Create regular snapshots.

Example daily cron (keeps last 14 backups):

```bash
# 03:30 daily
30 3 * * * cd /path/to/OwnTube && mkdir -p backups && \
  cp data/owntube.db "backups/owntube-$(date +\%F).db" && \
  ls -1t backups/owntube-*.db | tail -n +15 | xargs -r rm -f
```

Restore example:

```bash
cp backups/owntube-YYYY-MM-DD.db data/owntube.db
docker compose restart app
```
