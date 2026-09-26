# WebSub hub

A minimal [WebSub](https://www.w3.org/TR/websub/) hub at
`https://websub.nedworks.org/`. OwnTube's feeds advertise it with
`<atom:link rel="hub">`; podcast platforms (Pocket Casts) subscribe to it and
get new feed content pushed within seconds of a change instead of polling.

- **Subscribe/unsubscribe** — anyone may ask; every request is confirmed by
  calling the callback back with a challenge. Callbacks must resolve to public
  addresses. Topics must be on a host listed in `HUB_TOPIC_HOSTS`.
- **Publish** — only the feeds server, with `Authorization: Bearer
  $HUB_PUBLISH_TOKEN`, one `hub.url` per changed feed.
- **Per-user topics** — topic URLs carry the feed's credentials
  (`https://user:pass@owntube.nedworks.org/rss/...`). The hub fetches each
  subscription's topic with its own credentials, and matches announcements
  (`https://user@...`, no password) on username + URL.
- **DNS rebinding** — the hub's outbound requests to callbacks (verification
  and delivery) are made with a fetch that re-checks every resolved address
  at connect time, so a callback host can't pass the public-address check and
  then resolve to a private address for the real connection. Topic fetches
  use a plain fetch instead: topic hosts are operator-configured
  (`HUB_TOPIC_HOSTS`), not supplied by a subscriber, so they need no guard.

With the hub on, a feed's own `<atom:link rel="self">` carries the requesting
user's full credentials (`https://user:pass@.../rss/...`) — it *is* the WebSub
topic the hub fetches, so it has to be exact. Podcast apps that display or
share "the feed URL" will therefore show the password. That's accepted: it's
the same URL the user already pasted into the app to subscribe (see
`feeds/server/README.md`), so nothing new is exposed — it's just visible in
one more place.

| Variable | Purpose |
|---|---|
| `HUB_URL` | This hub's public URL |
| `HUB_TOPIC_HOSTS` | Comma-separated hostnames whose feeds this hub serves |
| `HUB_PUBLISH_TOKEN` | Bearer token the feeds server announces with |
| `DATA_DIR` | SQLite location (`hub.db`) |

Tests: `npm test`. Deploy: `docker compose up -d --build` on spiff with
`HUB_PUBLISH_TOKEN` in `.env`.
