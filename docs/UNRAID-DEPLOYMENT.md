# Unraid Deployment

This guide deploys OwnTube as a Docker container on Unraid with persistent SQLite storage.

## 1) Prepare folders on Unraid

Create the appdata directory:

```bash
mkdir -p /mnt/user/appdata/owntube/data
```

## 2) Prepare environment file

From the project root on your Unraid host:

```bash
cp env.unraid.example .env.unraid
```

Edit `.env.unraid` and set at least:

- `AUTH_SECRET` (required, strong random value)
- `AUTH_URL` (required, public URL used by browsers, e.g. `http://192.168.1.11:3000`)
- `AUTH_TRUST_HOST=true`
- `PIPED_BASE_URL` and/or `INVIDIOUS_BASE_URL`
- `APP_BASE_URL` (URL you open in the browser — LAN IP or reverse-proxy HTTPS)
- `UPSTREAM_RATE_LIMIT_MAX_REQUESTS=300` (or higher) when self-hosting upstreams on LAN

Generate a strong secret:

```bash
openssl rand -base64 48
```

## 3) Build and start

```bash
docker compose -f docker-compose.unraid.yml --env-file .env.unraid up -d --build
```

The app listens on port `3000` by default.

## 4) Update flow

```bash
git pull
docker compose -f docker-compose.unraid.yml --env-file .env.unraid up -d --build
```

## 5) Useful commands

Logs:

```bash
docker compose -f docker-compose.unraid.yml --env-file .env.unraid logs -f app
```

Stop:

```bash
docker compose -f docker-compose.unraid.yml --env-file .env.unraid down
```

## Reverse proxy (recommended)

Expose OwnTube behind your reverse proxy (Nginx Proxy Manager, Traefik, etc.) and enable HTTPS.

Typical upstream target:

- Host: your Unraid server IP
- Port: `3000`

## Notes

- Database migrations run automatically on container startup.
- SQLite data is persisted in `/mnt/user/appdata/owntube/data`.
- If you self-host Invidious on the same Unraid server, prefer using its LAN URL (not `localhost`) unless both services are on the same Docker network.
- Variables in `.env.unraid` are only applied when listed in `docker-compose.unraid.yml` `environment:` — after editing either file, recreate the container (`up -d --build`).
- Verify the rate limiter inside the running container:

```bash
docker exec owntube printenv UPSTREAM_RATE_LIMIT_MAX_REQUESTS
```

It should print `300` (or your chosen value), not be empty.

- Warm the home feed cache after deploy (optional cron every 20 min):

```bash
docker exec owntube pnpm warm:feed
```
