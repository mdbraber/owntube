# Feeds

Podcast feeds for OwnTube, in two halves that talk over one HTTP call.

```
web app (home) ──POST /publish (Bearer)──▶ server (public: owntube.nedworks.org)
                                               │  ├── /<feed>.rss        Basic Auth, per user
                                               │  ├── /chapters/<id>.json public
                                               │  └── /icon.png          public (cover art)
                                               │
                                               └─hub.mode=publish──▶ hub (public: websub.nedworks.org)
                                                                        └──▶ subscribers (Pocket Casts)
```

**Publishing** happens inside the web app (`apps/web/src/server/remote/publish-loop.ts`,
started from `instrumentation.ts` when `OWNTUBE_PUBLISH_TARGET` is set): it
builds every user's feed snapshots from the app's database and POSTs them to
the server shortly after anything a feed is built from changes, and at least
every `OWNTUBE_PUBLISH_INTERVAL_SEC`.

**`hub/`** is a WebSub hub. The server announces the feeds whose content
changed; the hub pushes them to subscribed podcast platforms. See `hub/README.md`.

**`server/`** is the public mirror. It holds no OwnTube logic: it stores what it
is given and renders RSS from it. It runs on a public host precisely because
podcast apps and directories cannot reach the LAN — and it serves chapters and
cover art unauthenticated for the same reason, since clients fetch those bare,
without the feed's credentials.

**WebSub** rides the same pair. The server is also the WebSub subscriber for
YouTube uploads — Google's hub can only push to a public URL — and queues the
notifications; each pusher run drains the queue with one outbound
`POST /websub/sync` and folds the uploads into the home RSS cache within about
a minute. See `server/README.md` and `apps/web/src/server/websub/sync.ts`.

Not to be confused with **invidious-companion**, an unrelated third-party
service this repo also talks to (media and captions). The word "companion" in
`docs/` and `apps/` refers to that one.
