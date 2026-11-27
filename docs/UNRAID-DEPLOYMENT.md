# Unraid Deployment

This guide deploys OwnTube on Unraid as two containers, `owntube` (the web app)
and `owntube-gateway` (its YouTube gateway), with persistent storage under
appdata. See [SELF-HOSTING.md](SELF-HOSTING.md) for what each part does.

## 1) Prepare folders on Unraid

```bash
mkdir -p /mnt/user/appdata/owntube/data /mnt/user/appdata/owntube/gateway
# The gateway runs as uid 1000 (node) and needs to write its cache here.
chown 1000:1000 /mnt/user/appdata/owntube/gateway
```

## 2) Prepare environment file

From the project root on your Unraid host:

```bash
cp apps/web/env.unraid.example .env.unraid
```

Edit `.env.unraid` and set at least:

- `AUTH_SECRET` (required, strong random value)
- `GATEWAY_SIGNING_KEY` (required, another strong random value, at least 32 characters)
- `AUTH_URL` (required, the URL browsers use, e.g. `http://192.168.1.11:3000`)
- `AUTH_TRUST_HOST=true`

Generate each secret with:

```bash
openssl rand -base64 48
```

## 3) Build and start

```bash
docker compose -f docker-compose.unraid.yml --env-file .env.unraid up -d --build
```

The app listens on port `3000`. The gateway has no published port; the app
forwards `/media/*` to it.

## 4) Update flow

```bash
git pull
docker compose -f docker-compose.unraid.yml --env-file .env.unraid up -d --build --remove-orphans
```

## 5) Useful commands

Logs:

```bash
docker compose -f docker-compose.unraid.yml --env-file .env.unraid logs -f app gateway
```

Stop:

```bash
docker compose -f docker-compose.unraid.yml --env-file .env.unraid down
```

One-shot cache warm after a deploy:

```bash
docker exec owntube pnpm warm:cache
```

## Reverse proxy (recommended)

Expose OwnTube behind your reverse proxy (Nginx Proxy Manager, Traefik, etc.)
and enable HTTPS. Typical upstream target: your Unraid server IP, port `3000`.
To take media load off the app, route `/media/*` to the gateway (port 8080) on
the same Docker network; otherwise the app forwards it.

## Notes

- Database migrations run automatically on container startup.
- SQLite data is persisted in `/mnt/user/appdata/owntube/data`; the gateway's
  caches in `/mnt/user/appdata/owntube/gateway` (no backup needed).
- The cache warmer runs inside the app every `OWNTUBE_WARM_INTERVAL_SEC`
  (default 900, `0` disables it); there is no separate `cache-warmer`
  container any more.
- Variables in `.env.unraid` are only applied when listed in
  `docker-compose.unraid.yml` `environment:`. After editing either file,
  recreate the containers (`up -d --build`).
- Coming from the Invidious setup? See
  [Upgrading from the Invidious setup](SELF-HOSTING.md#upgrading-from-the-invidious-setup).
  Remove `INVIDIOUS_*`, `PIPED_*` and `UPSTREAM_RATE_LIMIT_*` from `.env.unraid`,
  and add `--remove-orphans` once so the old `owntube-cache-warmer` container goes.
