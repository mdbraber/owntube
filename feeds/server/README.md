# OwnTube feeds server

A tiny public RSS mirror for a LAN-only OwnTube. The home OwnTube **pushes**
self-contained feed snapshots here; this service stores them and renders podcast
RSS. Every `<enclosure>` URL points back at the LAN media origin
(`/media/<id>.m4a` / `.mp4`), so the feed *metadata* is public (behind Basic
Auth) while the media only streams on the LAN.

```
feeds pusher ──POST /publish (Bearer)──▶ feeds server (spiff, owntube.nedworks.org)
                                          └ GET /rss/<kind>/<slug>.{audio,video}.xml  (Basic Auth)
podcast app ──(LAN/VPN)──▶ owntube /media/<id>   ◀── enclosure URLs
```

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/publish` | Bearer `PUBLISH_SECRET` + IP allow-list | Replace the full feed + credential set with the pushed payload |
| GET | `/rss/<kind>/<slug>.audio.xml` | Basic (per user) | Podcast RSS, m4a enclosures |
| GET | `/rss/<kind>/<slug>.video.xml` | Basic (per user) | Podcast RSS, mp4 enclosures |
| GET | `/` | Basic (per user) | HTML index of your feeds |
| GET | `/opml.xml` | Basic (per user) | OPML of your feeds (both variants) |
| GET | `/chapters/<videoId>.json` | none | Podcasting 2.0 JSON chapters (public YT-derived data) |
| GET | `/icon.png` | none | OwnTube icon — stable podcast cover art |
| GET | `/health` | none | Liveness |
| GET | `/websub/callback` | none | WebSub hub verification (only when `WEBSUB_CALLBACK_URL` is set) |
| POST | `/websub/callback` | hub HMAC signature | WebSub upload notification |
| POST | `/websub/sync` | Bearer `PUBLISH_SECRET` + IP allow-list | Home hands over its subscribed channels and drains queued notifications |

Feed `kind` ∈ `playlist`, `queue`, `saved`, `subscriptions`, `tag`, `channel`.

Basic Auth is **per user**: the publisher pushes each OwnTube account's
username (the full email address) and the SHA-256 of its generated RSS
password (shown in OwnTube → Settings → Podcast feeds) along with the
snapshots — no plaintext password ever reaches this host. Every feed route
serves only the authenticated owner's feeds, so two accounts can both have
`queue`.

Subscribe in a podcast app with the credentials inline (percent-encode the
`@` in the email; clients that forward it un-decoded still authenticate):

```
https://user%40example.com:<rss-pass>@owntube.nedworks.org/rss/queue/queue.audio.xml
```

With a WebSub hub configured (see `feeds/hub/README.md`), each feed's own
`<atom:link rel="self">` is this exact credentialed URL — it doubles as the
WebSub topic the hub fetches. A podcast app that displays or shares "the feed
URL" will therefore show the password; that's accepted, since it's the same
URL the user already pasted in to subscribe.

## Config (env)

| Var | Required | Default | |
| --- | --- | --- | --- |
| `PUBLISH_SECRET` | yes | — | Must match the home side's `OWNTUBE_PUBLISH_SECRET` |
| `PUBLISH_ALLOW_HOSTS` | no | — | Comma-separated hostnames allowed to POST `/publish`; re-resolved ~60s (DDNS-safe) |
| `PUBLISH_ALLOW_IPS` | no | — | Comma-separated extra IPs/CIDRs allowed to POST `/publish` |
| `WEBSUB_CALLBACK_URL` | no | — | Public URL of `/websub/callback`; setting it turns WebSub on |
| `WEBSUB_HUB_URL` | no | `https://pubsubhubbub.appspot.com/subscribe` | |
| `WEBSUB_SECRET` | no | derived from `PUBLISH_SECRET` | `hub.secret` for notification signatures |
| `PORT` | no | `8080` | |
| `DATA_DIR` | no | `/data` | SQLite location |

`/publish` accepts a request only when it passes **both** the Bearer secret and
(if either `PUBLISH_ALLOW_*` is set) the IP allow-list. Client IP is taken from
the rightmost `X-Forwarded-For` value (Caddy-set). With neither var configured
the IP check is off.

## WebSub (push for new uploads)

YouTube announces every channel's uploads through Google's WebSub hub. The hub
can only push to a public URL, so this server is the subscriber on home's
behalf:

```
home pusher ──POST /websub/sync {channels, ack}──▶ feeds server ──subscribe──▶ hub
            ◀──────────── {events} ──────────────   ◀──POST /websub/callback──  (signed Atom)
```

- Every pusher run (~60 s) sends the full set of subscribed channel ids. The
  server subscribes new ones at the hub (25 requests a minute), renews each
  lease a day before it lapses (the hub grants ~5 days), and unsubscribes
  channels that dropped out.
- A hub verification GET only renews a lease when it answers one of our own
  requests from the last hour; notifications are checked against the
  `hub.secret` HMAC and dropped unless their channel is wanted.
- Notifications queue in SQLite until home acks them on its next call
  (at-least-once), and are pruned after 14 days unacked.

Home re-fetches the channel's RSS on each push and overlays the pushed entry
until youtube.com's (lagging) feed lists it, and warms each new upload's
detail, streams and comments so it opens instantly. The cache warmer keeps polling
every channel as the safety net: the hub is known to drop notifications.

Set `OWNTUBE_WEBSUB=false` on the pusher to stop syncing.

## Run

```sh
cp .env.example .env   # fill in the secrets
docker compose up -d --build
```

Local dev (needs Node ≥ 22 for `.ts` execution, or use `npx tsx`):

```sh
npm install
PUBLISH_SECRET=x DATA_DIR=./data npm start
npm test    # render unit tests
```

## Tests

```bash
cd feeds/server
npm install     # not part of the pnpm workspace: it ships as its own container
npm test
```

Node 22 (see `.nvmrc`), matching the Dockerfile. `better-sqlite3` publishes
prebuilt binaries per Node major; on a newer Node it falls back to compiling
from source and the install fails, which is why the version is pinned rather
than left to whatever `node` happens to be on PATH.

## Deploy on spiff

Lives at `/var/docker/owntube-feeds-server/` on spiff, fronted by its
caddy-docker-proxy (`caddy` external network, `caddy` label prefix — see
`docker-compose.yml`). Public TLS is provisioned automatically by Caddy. The
feeds server does its own HTTP Basic Auth, so it deliberately does **not** import
spiff's `auth` (authelia) snippet — a login portal would break podcast-client
credentials.

```sh
# from the owntube repo on naggon:
rsync -az --delete --exclude node_modules --exclude data --exclude '*.db*' \
  feeds/server/ root@spiff.nedworks.org:/var/docker/owntube-feeds-server/
# create /var/docker/owntube-feeds-server/.env on spiff (PUBLISH_SECRET must match
# the home side's OWNTUBE_PUBLISH_SECRET; feed credentials come with each publish)
ssh root@spiff.nedworks.org 'cd /var/docker/owntube-feeds-server && docker compose up -d --build'
curl -sf https://owntube.nedworks.org/health   # -> ok
```
