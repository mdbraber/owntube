# OwnTube feeds server

A tiny public RSS mirror for a LAN-only OwnTube. The home OwnTube **pushes**
self-contained feed snapshots here; this service stores them and renders podcast
RSS. Every `<enclosure>` URL is a signed URL on the LAN media gateway
(`/media/v/<id>/…`), so the feed *metadata* is public (behind an
unguessable per-user secret address) while the media only streams on the LAN.

```
web app      ──POST /publish (Bearer)──▶ feeds server (spiff, owntube.nedworks.org)
                                          └ GET /rss/<token>/<kind>/<slug>.{audio,video}.xml
podcast app ──(LAN/VPN)──▶ owntube /media/v/<id>/…  ◀── enclosure URLs
```

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/publish` | Bearer `PUBLISH_SECRET` | Replace the full feed and token set with the pushed payload |
| GET | `/rss/<token>/<kind>/<slug>.audio.xml` | secret token | Podcast RSS, m4a enclosures |
| GET | `/rss/<token>/<kind>/<slug>.video.xml` | secret token | Podcast RSS, mp4 enclosures |
| GET | `/rss/<token>/` | secret token | HTML index of that user's feeds |
| GET | `/rss/<token>/opml.xml` | secret token | OPML of that user's feeds (both variants) |
| GET | `/chapters/<videoId>.json` | none | Podcasting 2.0 JSON chapters (public YT-derived data) |
| GET | `/icon.png` | none | OwnTube icon — stable podcast cover art |
| GET | `/health` | none | Liveness |
| GET | `/websub/callback` | none | WebSub hub verification (only when `WEBSUB_CALLBACK_URL` is set) |
| POST | `/websub/callback` | hub HMAC signature | WebSub upload notification |
| POST | `/websub/sync` | Bearer `PUBLISH_SECRET` | Home hands over its subscribed channels and drains queued notifications |

Feed `kind` ∈ `playlist`, `queue`, `saved`, `subscriptions`, `tag`, `channel`.

## Secret feed addresses

Each user is issued an opaque per-user token (32 lowercase hex chars) that
unlocks their feeds with no password at all: `/rss/<token>/<kind>/<slug>.{audio,video}.xml`
for a feed, `/rss/<token>/` for the HTML index, `/rss/<token>/opml.xml` for
OPML. The token is generated and pushed by the publisher (home OwnTube) with
each user's `username` in the `/publish` payload (`users: [{ username,
feedToken }]`); this server only stores and serves it — it never mints one.

A request for an unrecognized or malformed token gets a bare `404`, without
touching the database for anything that doesn't look like a token
(`/^[0-9a-f]{32}$/`). Every hit — including unknown tokens — is logged with
only the token's first 6 characters (`012345…`), never the full value, so logs
can be shared without leaking a live secret address. Responses carry
`cache-control: private, max-age=300`, since the content is per-user.

Subscribe in a podcast app with the secret address directly — no credentials
to embed or leak:

```
https://owntube.nedworks.org/rss/<token>/queue/queue.audio.xml
```

With a WebSub hub configured (see `feeds/hub/README.md`), each feed's own
`<atom:link rel="self">` is this exact secret address — it *is* the WebSub
topic the hub fetches. A feed whose owner has no token yet gets no pushes at
all.

## Config (env)

| Var | Required | Default | |
| --- | --- | --- | --- |
| `PUBLISH_SECRET` | yes | — | Must match the home side's `OWNTUBE_PUBLISH_SECRET` |
| `HUB_URL` | no | — | Public URL of our WebSub hub (`feeds/hub`), advertised in every feed; needs the next two |
| `HUB_PUBLISH_TOKEN` | with `HUB_URL` | — | Bearer token for announcing changed feeds to the hub |
| `PUBLIC_URL` | with `HUB_URL` | — | This server's public origin (no path), used for the feeds' self links / hub topics |
| `HUB_PUBLISH_URL` | no | `HUB_URL` | Where announcements go (e.g. the hub's internal Docker address) |
| `WEBSUB_CALLBACK_URL` | no | — | Public URL of `/websub/callback`; setting it turns the YouTube WebSub subscriber on |
| `WEBSUB_HUB_URL` | no | `https://pubsubhubbub.appspot.com/subscribe` | |
| `WEBSUB_SECRET` | no | derived from `PUBLISH_SECRET` | `hub.secret` for notification signatures |
| `PORT` | no | `8080` | |
| `DATA_DIR` | no | `/data` | SQLite location |

`/publish` and `/websub/sync` accept a request only with the Bearer secret.
Keep it long and random (`openssl rand -hex 32`): it is the only gate.

## YouTube WebSub subscriber (push for new uploads)

Not to be confused with our own hub (`HUB_URL`, `feeds/hub`), which pushes
*our* feeds to podcast apps. This is the other direction.

YouTube announces every channel's uploads through Google's WebSub hub. The hub
can only push to a public URL, so this server is the subscriber on home's
behalf:

```
web app     ──POST /websub/sync {channels, ack}──▶ feeds server ──subscribe──▶ hub
            ◀──────────── {events} ──────────────   ◀──POST /websub/callback──  (signed Atom)
```

- The in-app publisher (`publish-loop.ts`, about once a minute) sends the full set of subscribed channel ids. The
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

Set `OWNTUBE_WEBSUB=false` on the web app to stop syncing.

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
feeds server's routes are unlocked by a per-user secret address (see "Secret
feed addresses" above), so it deliberately does **not** import spiff's `auth`
(authelia) snippet — a login portal would break podcast-client subscriptions
that carry no credentials of their own.

```sh
# from the owntube repo on naggon:
rsync -az --delete --exclude node_modules --exclude data --exclude '*.db*' \
  feeds/server/ root@spiff.nedworks.org:/var/docker/owntube-feeds-server/
# create /var/docker/owntube-feeds-server/.env on spiff (PUBLISH_SECRET must match
# the home side's OWNTUBE_PUBLISH_SECRET; feed tokens come with each publish)
ssh root@spiff.nedworks.org 'cd /var/docker/owntube-feeds-server && docker compose up -d --build'
curl -sf https://owntube.nedworks.org/health   # -> ok
```
