# OwnTube monorepo: one codebase from browser to YouTube

Status: **phases 0–2 done**, 2026-11-26. Written against GitHub `main` `a2bd519` (OwnTube),
the production companion tree `/usr/local/src/invidious-companion-sabr` `12afa50`
(upstream `07ae73c` + 54 commits) and the Invidious fork `nedworks/integration`
`39f4a9ff`. Supersedes the "do not replace Invidious" non-goal in
`INVIDIOUS-BOUNDARY-PLAN.md`: that rested on not owning YouTube parsers, and
youtubei.js already sits on the critical playback path via the companion.

## Goal and rules

Bring everything OwnTube runs into this monorepo, in TypeScript on **Node 22**:
no Invidious, no Deno, no forks of other people's services.

- **No workarounds.** Anything that exists only because of a boundary between
  OwnTube, Invidious and the companion is deleted, not ported: URL rewriting of
  upstream manifests, inferred fields, multi-instance failover, `check=` AES
  signing, Invidious-shaped JSON, retries against our own services.
- **Greenfield where it is better.** Re-architect a part when the current shape
  is a consequence of the split; port it when the logic is inherent to YouTube
  (client identities, SABR, /64 flagging, sidx/Cues indexing — keep those, with
  the measured rationale in comments).
- **No compatibility shims.** We control every client (web, Android TV/tvOS, iOS),
  so the API changes once and all clients ship with it.

## What we have today (measured)

| component | size | what OwnTube uses |
|---|---|---|
| Invidious fork (Crystal) | 21.6k lines; ~5k are YouTube parsing; 11 local patches, 6 of them parser fixes | read-only metadata (`/api/v1/videos`, `related`, `channels/*`, `search`, `suggestions`, `trending`, `comments`, `playlists`, `resolveurl`) and the `/vi`,`/ggpht`,`/ytc` image proxy. No accounts, no DB use. |
| Invidious Postgres | — | nothing (Invidious's own state only) |
| companion (Deno) | 8.1k lines: 2.8k upstream, **~6.4k ours** | SABR VOD/live, DVR manifest, captions, `/videoplayback`. Upstream had 8 `src` commits in six months. |
| OwnTube web, upstream-related code | ~12k of 33.6k server/app/lib lines | facade `server/services/proxy.ts`; Invidious mappers (`mappers/invidious.ts`, `normalize.ts`); 9 playback paths; media proxies; caches; warmer |

The audit of OwnTube's boundary code found, by root cause: revoked IP-bound
googlevideo URLs (retry/refetch/self-heal in every media route), rewriting of
upstream URLs and manifests (`invidious-proxy.ts`, `hls-same-origin.ts`, three
manifest rewriters), inferred fields (`[inferred]` in `proxy.types.ts`,
`listing-rows/repair.ts`, related-channels graph, shorts-by-search), upstream
flakiness (captions retries, thumbnail chain, channel fallbacks), multi-instance
health (`upstream-health.ts`, `proxy/config.ts`, port-collision checks), the AES
`check=` scheme, the same video payload fetched by three independent paths, and
Piped remnants. Playback selection exists in three copies (web
`pick-playback.ts`, TV `WatchScreen.tsx`, iOS `store.ts`).

## Target architecture

```
 browser / Android TV / tvOS / iOS
   │  pages, tRPC, auth                    │  /media/*  (manifests, segments,
   ▼                                       ▼            captions, images, files)
 ┌───────────────────────────┐  HTTP  ┌──────────────────────────────────────┐
 │ apps/web  (Next.js)       │──────► │ apps/gateway  (Node, Hono)           │
 │ UI, tRPC, auth, devices   │ typed  │ the only process that talks to       │
 │ SQLite: users, history,   │ client │ YouTube                              │
 │  subscriptions, playlists,│        │  metadata API  (packages/youtube)    │
 │  queue, tags, feeds       │        │  playback sessions + manifests       │
 │ recommendations, RSS/     │        │  segments: SABR, byte-range, live    │
 │  WebSub, SponsorBlock,    │        │  captions, images (disk cache)       │
 │  jobs (warm, publish)     │        │  PO tokens (Camoufox child process)  │
 │ signs playback URLs       │        │  egress: addresses, /64 flagging     │
 └───────────────────────────┘        │ SQLite: metadata cache               │
                                       └──────────────────┬───────────────────┘
 Caddy: /media/* → gateway, everything else → web          ▼  YouTube
```

**Two processes, one repo.** `web` owns users and decisions; `gateway` owns
everything that touches YouTube. They stay separate because the gateway holds
long-lived state (YouTube sessions, SABR pulls, a resident browser for PO tokens,
up to several GB) and streams; a web deploy must not cut streams, and Camoufox's
memory must not sit in the Next.js process. Everything is served from **one
host**: Caddy routes `/media/*` to the gateway and the rest to web, so Next.js
never carries video bytes, and `owntube-media.home.nedworks.org`,
`NEXT_PUBLIC_MEDIA_BASE_URL`, `media-origin.ts` and the CORS code go away.

The second host was added (`b74caef`, 2026-07-21) because of a Safari HTTP/2
problem: one reset media stream (a segment fetch aborted during a seek) took
down the whole shared connection, and unrelated API calls such as
`history.upsertEvent` failed with it. Players abort fetches on seek by design,
so the trigger stays; what changes is how the server side behaves:

- **HTTP/3.** Streams are independent at the transport level, so a reset or a
  lost packet on a media stream does not stall or kill API calls (no TCP
  head-of-line blocking, no shared HTTP/2 stream state). `caddy-media` already
  offers it (checked 2026-11-26: `Alt-Svc: h3=":443"`, and `curl --http3-only`
  gets 200 from both hosts). Whether it was already offered on 2026-07-21, and
  whether Safari used it then, is unknown. So HTTP/3 alone is not proof that
  one host works.
- **A gateway that handles aborts cleanly.** A client abort cancels the
  upstream pull and ends the response normally. Today the abort travels through
  Caddy → Next.js route → companion → googlevideo, and we never established
  which hop turned it into a connection-level failure.
- **Fewer, smaller media requests.** Session segments replace the 2 MB chunk
  loops and redirect chains, so there is less to reset and less to congest.

**Tested 2026-11-26 on `owntube-dev`** with the second host switched off
(compose backup `docker-compose.dev.yml.bak-20261126-single-host`): seek-heavy
playback in Safari on macOS and iOS while using the app, with nothing failing
or hanging. The only difference noticed was speed, expected from `next dev`.
The second host therefore goes; production confirms it at cutover (phase 6),
when the gateway serves `/media/*` on the app host.

### Repository layout

```
apps/web          Next.js (existing), stripped of all upstream code
apps/gateway      new: Hono on @hono/node-server; replaces Invidious + companion
apps/tv, apps/ios clients (existing)
packages/contracts   domain model (zod) + typed gateway client + URL signing
packages/youtube     InnerTube layer: egress, sessions, PO tokens, player, browse
packages/playback    track model, HLS + DASH builders, client playback policy
packages/brand-icon  (existing)
feeds/               public WebSub/RSS stack (unchanged, out of scope)
```

`packages/playback`'s policy part is pure TypeScript with no Node or DOM
dependencies, so `apps/tv` and `apps/ios` (outside the pnpm workspace) import it
the way iOS already imports `@web/lib/pick-playback`.

### packages/youtube — the InnerTube layer

Designed fresh. Logic from the companion is ported into these seams, not its
module structure:

- **`Egress`**: the single way out. One cached `undici.Agent` per local address
  (`connect.localAddress`, LRU, closed on idle), optional `ProxyAgent`, timeouts,
  `AbortSignal` and `redirect` passed through (the Deno layer drops both today).
  Address policy: IPv4, or one address per YouTube session from an IPv6 block,
  with strike-based /64 flagging fed by player verdicts. Replaces
  `getFetchClient`, SABR `sessionFetch`, `egress.ts` and raw `fetch`.
- **`YouTubeSession` / `SessionPool`**: an identity = client (VISIONOS,
  ANDROID_VR, WEB, …), visitorData, PO token, egress address, health. Sessions
  are leased from a pool, rotated on schedule or on bot verdicts. Replaces the
  global `innertubeClient`/`tokenMinter` and the per-SABR-session bootstrap
  request.
- **`PoTokenProvider`**: one interface, used only by the features that need a
  PO token (see "PO tokens" below). Unifies today's two systems (the minter and
  the separate `SABR_POT_URL`).
- **Player**: typed `PlayerResponse`/`Format` model (no `any`), client fallback
  order, deciphering via youtubei.js with a Node `Platform.shim.eval`, typed
  playability errors (unavailable, age, members-only, login/bot, upcoming, geo,
  live-not-started) — no error-text matching.
- **Browse**: video details + related (`next`), channel tabs (videos, shorts,
  streams, playlists, about, featured channels), search + suggestions, comments,
  playlists, handle resolution, live/gaming feeds. youtubei.js parsers, mapped
  straight into `packages/contracts`. Fields we had to patch into Invidious come
  out native: `isShort`, `audioTrack`, live/upcoming detection from overlays,
  collaboration views/dates, exact `publishedAt`, view and subscriber counts as
  numbers.

### packages/contracts — one domain model

The rest of the app consumes this, and nothing upstream-shaped crosses it.
Starts from `proxy.types.ts` and removes: every `[inferred]` field (they become
real data or disappear), `sourceUsed`, `mediaProxyBase`, raw `hlsUrl`/`dashUrl`,
raw `videoSources`/`audioSources` URLs. `VideoDetail` gains a `playback` object
of signed gateway URLs instead. Thumbnails are emitted as `/media/img/...` URLs
directly (no `stripGoogleImageUrls` post-pass). Includes the typed gateway client
web uses and the HMAC signer/verifier for playback URLs.

### Media plane — playback sessions

Today the client chooses among nine paths (byte-range DASH/HLS, SABR DASH/HLS,
live DASH/HLS, DVR, progressive, Invidious `hlsUrl`) with env flags and
fallbacks on both sides. In the target, **transport is a gateway concern**:

```
GET /media/v/<id>/manifest.mpd|.m3u8?codecs=…&maxHeight=…&audio=…&exp=…&sig=…
    → creates a playback session <sid> (identity, egress address, player
      response, track index, readers) and returns a manifest whose every URL
      is relative to it:
GET /media/s/<sid>/<track>/init | /<n>        segments (VOD, live, DVR)
GET /media/s/<sid>/captions/<lang>.vtt        captions, timedtext fetched in-session
GET /media/v/<id>/file.m4a|.mp4?…&sig=        whole file (RSS enclosures, downloads)
GET /media/img/<kind>/<path>                  thumbnails, avatars, storyboards (disk cache)
```

- **One track model, two serializers.** `packages/playback` builds HLS and DASH
  from the same tracks (byte-range, SABR-backed, live), so OwnTube's
  `hls/generate.ts` + `dash/generate.ts` and the companion's MPD builders merge,
  and the three rewriters (`sabr-vod.ts`, `live-manifest.ts`, `dvr-manifest.ts`)
  disappear because manifests are built where segments are served.
- **Session-keyed URLs** fix the companion's video-wide segment lookup, carry
  the client identity (so the right UA goes out — today ANDROID_VR URLs get a
  Chrome UA), and remove the stream-id→video reverse map. Revoked URLs are
  replaced inside the session; the client never sees a 403 to retry.
- **Access**: web signs the manifest/file URL (HMAC, `exp`, video id; query
  string, which survives TV and cast players); the `sid` is unguessable after
  that. Replaces the AES `check=` and closes today's open `/dash`/`/hls` routes.
- **Client policy shrinks** to: DASH or HLS, codec capabilities, max height,
  audio language, plus step-down on error. One implementation in
  `packages/playback`, used by web, TV and iOS.
- **Bounded state**: LRU+TTL for sessions, live manifests and refresh logs; chunk
  lists instead of `Buffer.concat` per chunk in the readers.

### PO tokens: need fewer, and run the browser only when minting

Measured on naggon (2026-11-26): the companion process uses ~606 MB and the
resident Camoufox ~680 MB more (main process 313 MB + content processes), kept
alive around the clock to mint a token about once an hour. JSDOM + bgutils, the
light option, has been useless since 2026-09-23, when YouTube started rejecting
every JSDOM token; that is why Camoufox came in.

1. **Shrink what needs a token.** The paths that need none: SABR VOD (VISIONOS)
   and live/DVR (ANDROID_VR). The paths that use one today: the WEB player
   request behind byte-range URLs, SABR dubbed audio (WEB + video-bound token)
   and caption fetches. Phase 1 records, per feature, which client works
   without a token. If the phase 2 measurement makes SABR the VOD default and
   dubbed audio and captions work from a token-free client, the browser goes
   away completely, which is the best result.
2. **Whatever still needs one gets an on-demand browser**: a child process
   started when a token is needed and shut down after an idle period
   (e.g. 10 min), instead of a resident one. Tokens last hours, so most of the
   day nothing runs. Video-bound tokens are minted in batches while it is up.
3. **Evaluate a lighter engine before keeping Camoufox.** Candidates:
   `chrome-headless-shell` through `playwright-core` (smaller download, one
   process tree, no fingerprint database). The test is the same one that ended
   JSDOM: token validation rate over a day from our egress. Camoufox stays only
   if nothing lighter validates. External providers (bgutil-ytdlp-pot-provider
   and its ports) run the same BotGuard-in-JS approach that YouTube now
   rejects, so they are not an alternative.

### Data and caching

- **web SQLite** keeps all user data as today. `video_cache` is removed from web.
- **gateway SQLite** (`better-sqlite3`, same as web) caches metadata with the
  existing per-kind TTLs and serve-stale; in-memory LRU for player responses
  (1 h, bypassed for live/DVR) and sessions; cacache for images (moved from web).
  Caches live where freshness against YouTube is known.
- **In-flight dedupe** lives once, in the gateway client of each resource.
- **Cache warmer** stops being a sidecar (each sidecar built its own image and
  went stale): it becomes a scheduled job in web, asking the gateway to prefetch
  subscribed channels, trending/live and home feeds. Warming video details is
  dropped — stream URLs expire and sessions are cheap now.
- **Rate limiting** moves to the gateway as protection of our YouTube identity
  (per session/address), replacing the per-Invidious-instance counter.

### Operations

- One zod-validated config per app; no `process.env` reads outside it.
- Gateway readiness reflects sessions, PO token and egress, plus Prometheus
  metrics (sessions, readers, flagged /64s, YouTube error classes).
- Compose: `web`, `gateway`. Removed: `invidious`, `invidious-db`,
  `invidious-companion`, `owntube-cache-warmer` (and the canary). Gateway keeps
  the companion's hardening: read-only root, writable cache volume,
  `ip_nonlocal_bind` when an IPv6 block is used, `shm_size` for the browser
  (only if one is still needed).
- `check-upstream.ts` is replaced by a fixture-based contract suite plus a
  short live smoke run (`pnpm smoke`) that the deploy script runs.

## Phases

Prod keeps running on the current stack until phase 6. Phases 1–5 are developed
on a branch (tested locally: unit tests, `next build`, e2e against a local
gateway) and each has an exit check. `owntube-dev` ran phases 1–3 side by side;
it was removed on 2026-11-26 (with the `owntube-claude` sandbox): it shared
prod's database and `.env`, which made it a hazard more than a safety net.
Phase 6 cuts prod over directly, with the previous images ready to roll back.

**Phase 0 — scaffolding and corpus. — DONE (branch `gateway/phase-0`)**

- `tsconfig.node.json`: shared base for the Node packages. They run as
  TypeScript directly on Node's type stripping (`erasableSyntaxOnly`, `.ts`
  import extensions), so there is no build step.
- `apps/gateway`: Hono on `@hono/node-server`, one zod config, `/healthz`,
  graceful SIGTERM, Dockerfile (`node:24-bookworm-slim`). Root `pnpm test` now
  runs every workspace package.
- `packages/youtube` with the fixture corpus (`fixtures/corpus/*.json.gz`,
  16 recordings, 3.1 MB):
  - `src/fixtures/corpus.ts` lists the cases as the calls that exercise them.
  - `pnpm --filter @owntube/youtube record:corpus [ids]` records them.
  - `corpus.test.ts` replays every recording offline through youtubei.js and
    checks that it resolves the same way.
  - Before writing a file, the recorder replaces our address (every spelling
    of it: `ip=`, `/ip/`, `remoteHost`, the expanded IPv6 form in `sw.js_data`)
    and our visitor data with placeholders, then proves nothing survived. It
    refuses to write otherwise. A separate check against freshly fetched
    addresses found no leaks.
  - Subjects that come and go are discovered at record time, in a context
    whose traffic is not stored (`CORPUS_ID_<ENTRY>` overrides):
    - live and upcoming videos: from a live search and YouTube's Live page;
    - post-live DVR: from today's stream uploads and the Streams tabs of
      channels that are live now (`isPostLiveDvr` from ANDROID_VR);
    - members-only: from the Videos tabs of popular channels (members badge);
    - collaborations: from search (a byline that opens a channel dialog,
      "A and 7 more").
- *Moved out of phase 0:* the Trending → Live rename. The server side of it is
  rewritten in phase 4 anyway, and the TV app would ship twice. It lands in
  phases 4–5 with the gateway's `browse.live()`.

First data, recorded anonymously from naggon on 2026-11-26 with no PO token
and without the player JS (so no `signatureTimestamp`, which may matter for
WEB and TV):

| case | WEB | MWEB | TV_SIMPLY | ANDROID_VR | VISIONOS |
|---|---|---|---|---|---|
| ordinary, 2160p, HDR, dubbed, Short, live, post-live DVR, collaboration | UNPLAYABLE | UNPLAYABLE | UNPLAYABLE | OK | OK |
| members-only | UNPLAYABLE | UNPLAYABLE | UNPLAYABLE | UNPLAYABLE | UNPLAYABLE |
| age-restricted | LOGIN_REQUIRED | LOGIN_REQUIRED | UNPLAYABLE | LOGIN_REQUIRED | LOGIN_REQUIRED |
| upcoming | LIVE_STREAM_OFFLINE | LIVE_STREAM_OFFLINE | UNPLAYABLE | LIVE_STREAM_OFFLINE | LIVE_STREAM_OFFLINE |

Phase 1 repeats this with the player JS and per feature (formats, dubbed
audio tracks, captions) to decide the PO-token question.

**Phase 1 — `packages/youtube` core. — DONE**

Built (52 tests): client identities (`clients.ts`, constants as NewPipe and
youtubei.js send them); YouTube's decipher JS run in a fresh `node:vm` context
with a time limit (`decipher.ts`); the typed `/player` request (`player.ts`);
playability as a type, checked against the recorded responses
(`playability.ts`); `Egress`, one undici agent per source address, with
redirect and abort passed through and verified on IPv4 and IPv6
(`egress.ts`); `SessionPool`, one coherent visitor+address identity, rotated on
age or repeated bot checks, with the player JS shared (`session.ts`); the
`YouTube` entry point (`youtube.ts`). Two re-runnable probes:
`probe:clients` (what each client gives) and `probe:sustained` (whether
byte-range URLs survive a playback).

Measured from naggon on 2026-11-26, anonymous, **no PO token**:

| client | ladder | dubbed tracks | media | captions | live/DVR | byte-range at playback pace |
|---|---|---|---|---|---|---|
| **VISIONOS** | to 2160p | all | ok | ok | HLS | **whole 246 MB file in 759 s, no failure** |
| TV_SIMPLY (with player JS) | to 2160p | all | ok (live 400) | ok | HLS | revoked after 72 s (403) |
| ANDROID_VR | to 2160p | original only | ok | ok | HLS + DASH | revoked after 72 s (403) |
| WEB, MWEB | SABR only / 360p | – | – | ok | – | – |
| TV (Cobalt) | unplayable | | | | | |

Age-restricted videos need a signed-in account with every client (out of
scope for now). Captions fetched fine for every client that lists them.

**Transport order (decided 2026-11-26).** YouTube is closing token-free paths
one client at a time (WEB is SABR-only, ANDROID_VR has turned erratic; yt-dlp
issues #12482, #16150, #17348), so VISIONOS will not stay open forever. Both
SABR and PO tokens stay in the design as fallbacks, in this order, chosen per
playback session by the gateway:

1. VISIONOS byte-range: plain range proxy, no token, no SABR.
2. VISIONOS SABR: no token.
3. WEB SABR with a PO token: needs the on-demand browser.

The gateway steps down by itself when a step stops working (a 403 at the
start, SABR-only formats, a bot check), and the probes stay as tools to see
which step YouTube has closed. Building order: (1) in phase 2, (2) ported
from the companion in phase 2, (3) after that, with the PO-token engine
decided by measuring it then.

Not built, on purpose: IPv6 address rotation (production runs on IPv4 because
YouTube rejects the /56 as a whole; `AddressPolicy` is the seam if the block
becomes usable).

**Phase 2 — gateway media plane. — DONE (2026-11-26)**

Done (2026-11-26):

- **Byte-range VOD over VISIONOS.**
  - `packages/playback` holds the track model, the DASH (`SegmentBase`) and HLS writers and the sidx parser.
  - The gateway answers signed `/media/v/<id>/manifest.mpd|master.m3u8` by starting a playback session; every other URL is relative to that session.
  - Bytes go through the session's address, in 8 MB upstream pieces, and the URL set is replaced once on a 401 or 403.
  - YouTube labels VP9 as a bare `vp9`, which capability checks reject, so it is written out as `vp09.00.LL.08`.
- **Live and post-live DVR**: YouTube's HLS, with every URL rewritten into the session. Renditions are keyed by itag, and playlists are re-read upstream at most every 2 s.
- **Enclosures**:
  - `audio.m4a` serves the original language's AAC.
  - `video.mp4` is a fast-start MP4 assembled from the H.264 and AAC tracks without copying media (`packages/playback/mp4`). Its layout is stored on disk once per video. A 25-minute video takes 6 s on first build.
  - Fragment headers are read one at a time: YouTube revokes a URL after about 100 quick requests in a burst.
- **VISIONOS SABR, the second transport**, on unpatched googlevideo 5.0.1 (the companion's 4.1.1 patches are no longer needed). SABR delivers the file's own bytes (init, index and fragments identical to byte-range reads, checked), so it sits behind the same byte-range interface and manifests do not change with the transport: a range maps onto fragments from the index, a pull continues while reads are sequential and restarts on a jump, and `mfhd` sequence numbers confirm the position. A session steps down to SABR when a fresh URL set is still refused, or starts on it when there are no URLs or `GATEWAY_TRANSPORT=sabr`. Checked in Chromium over SABR: dash.js H.264, dubbed H.264+AAC, AV1, hls.js H.264, and `video.mp4`.
- **Images**: `/media/img/...`, limited to YouTube's image hosts, with a disk cache that serves stale entries while refreshing them and is pruned to a size cap.
- **Verified**:
  - headless Chromium: dash.js (VP9, AV1, H.264 with dubbed audio), hls.js (VOD, live, 4-hour DVR) and plain `<video>` (`video.mp4`) all play and seek to the end;
  - Safari on macOS and iOS: ordinary, 4K, 27 audio languages with subtitles, a vertical Short, live and DVR all work (tested by the owner through the dev gateway on `owntube-dev…/media/*`).

- **VP9/WebM over SABR**: `packages/playback/webm.ts` reads the Cues into one segment per cluster (checked on real files, 4K60 included), and SabrTrack recognises clusters by Timecode. All formats work on both transports.
- **SABR reload token** echoed in the next player request.
- **Attestation**: seen once on 2026-11-26, after many SABR pulls on one visitor identity (fresh sessions then worked for every format and position). A rejection now ends the pull at once and the gateway retries with a fresh identity (`SessionPool.retire`).
- **PO tokens (third step)**, built and switched off:
  - `BrowserPoTokenMinter` runs BotGuard through bgutils-js (MIT) in a Chromium started on demand and closed after 10 idle minutes, with every request from the page blocked.
  - The first token takes 0.9–1.2 s including the browser start, later ones 2–6 ms.
  - `GATEWAY_PO_BROWSER` turns it on; the image gets Chromium only with `--build-arg WITH_PO_BROWSER=true`.
  - Not validated: on 2026-11-26 YouTube answered player requests identically with no token, a forged one and a minted one, and WEB SABR delivered a whole file without one. The only place a token would count today is a SABR attestation demand, which cannot be produced on demand.
  - Every attestation demand is logged, so the first real validation shows up in the logs when YouTube starts asking. `probe:potoken` repeats the check.
  - The companion's minter was not copied (AGPL-3.0, from an upstream PR; OwnTube is MIT).

Open:

- Android TV (Media3): moves to phase 5, when the TV app uses the gateway.
- ~~A podcast app test of the enclosures~~: `video.mp4` (3.5 and 25 min, 720p/1080p) and `audio.m4a` play and seek in Safari (AVFoundation, the player iOS podcast apps use), checked by the owner through the rebuilt dev gateway. A subscription test in a real podcast app follows in phase 4, when the feeds come from the gateway.
- The Debian `chromium` package with Playwright in the image is untested (no Docker here).

**Phase 3 — gateway metadata API. — DONE (2026-11-26)**

- `packages/contracts` (zod): the domain model. Counts YouTube gives only as
  text are marked approximate; dates say whether they are exact or a day;
  images point at the gateway.
- `packages/youtube/browse`: mappers for Video, LockupView, ShortsLockupView,
  GridChannel/Channel and CommentView wherever YouTube wraps them;
  collaborations from YouTube's "Collaborators" dialog (in lists too);
  continuations of both kinds. `Catalog`: video pages (own player response
  through `YouTube.playable` + youtubei.js's page model over `/next` + WEB's
  microformat for the exact date), chapters, channel tabs with About (full
  description, links, exact video count), search and suggestions, comments,
  playlists, the Live page, handle resolution; later pages stateless.
- `YouTube.playable`: VISIONOS, then WEB for what VISIONOS refuses ("made for
  kids" videos among them); WEB's VOD formats are SABR-only, so such a session
  streams over SABR.
- Gateway `/api/*` behind the shared key, with a per-kind TTL cache that
  serves stale answers when YouTube fails.
- **Compared with Invidious** (173 videos, 42 channels, 10 searches, throttled,
  over IPv4): identical titles, channel ids and names, likes, live/upcoming
  flags, captions, keywords, subscribers, channel names/subscribers/avatars/
  banners, list durations and Shorts flags. Fixed from it: channel
  descriptions (cut at 160 characters), channels without a Videos tab (an
  error), exact dates for live streams and premieres, made-for-kids videos.
  Differences that are not gaps: durations (Invidious reports one second more
  than YouTube's own `lengthSeconds`), list views of members-only rows (absent
  vs Invidious's 0), live view counts (total vs Invidious's concurrent),
  related videos and search results (personalised per visitor), channel pages
  of 30 vs 60 (one page vs two).
- Found on the way: naggon's IPv6 /64 draws bot checks that IPv4 does not;
  `GATEWAY_EGRESS_FAMILY` (deploy with `ipv4`); the egress connect family now
  follows the source address.

- Storyboards come in two kinds: `vod` (a fixed set of sheets) and `live` (a
  template whose sheet number keeps growing).
- The catalogue cache keeps answers on disk too (`GATEWAY_CACHE_DIR/metadata.sqlite`,
  Node's built-in `node:sqlite`): a restart serves from it (10 ms instead of a
  YouTube round trip), rows expire when too old even to stand in, and an hourly
  prune keeps it under 100,000 rows.

**Phase 4 — web on the new contracts.**
Replace `server/services/proxy*` with the gateway client; Trending becomes Live
(route, tRPC router, warmer, labels) on the gateway's `browse.live()`; delete the Invidious
layer (mappers, `normalize.ts`, inference, `listing-rows/repair.ts`, upstream
health/config/rate limiter/`upstream-get.ts`, `invidious-proxy.ts`,
`hls-same-origin.ts`, Piped remnants) and the media routes the gateway now
serves (`/dash`, `/hls`, `/dvr`, `/stream`, `/yt-hls`, `/invidious`,
`/captions`, `/image`, `/channel-avatar`, `/enclosure`). Web player uses
`packages/playback` policy. Warmer becomes a web job.
*Exit*: web e2e suite green on dev against the gateway; Invidious unreachable
from dev.

*Done on the branch (2026-11-26), not deployed:* `server/catalog` (gateway client
plus one mapper) replaces `services/proxy*`; the Invidious layer, the media
routes and the progressive/split player paths are deleted (≈23k lines). The
cache lives in the gateway, which gained `?cache=only|refresh`, a batch
`/api/videos?ids=`, search's upload-date filter, signed `captions.vtt` and a
video's original audio language; `video_cache` keeps only the app's own data.
The player plays the signed DASH manifest where MSE does better and HLS
elsewhere (live and DVR: HLS); casting sends the signed HLS. Enclosures are
signed whole-file URLs (stable per 30 days, valid a year). Lists enrich in one
batch call; related channels lead with featured channels; the warmer is a web
job; Trending is Live (`/trending` redirects); instance settings are gone;
compose runs web + gateway, `/media/*` forwarded by the app when no proxy
routes it. Verified: web typecheck, 578 web unit tests (gateway 40, youtube 103,
playback 25, contracts 7), `next build`, and e2e 8/8
against a local gateway (DASH playback with every request on the site).
*Left for the cutover:* the e2e on prod; Safari (native HLS) by hand; the TV and
iOS apps (phase 5) still read the removed playback fields.

**Phase 5 — clients.**
TV and iOS take `detail.playback` URLs, the shared policy and the Live rename; their own
selection copies and raw-URL fallbacks are removed. Release TV via gloob and
iOS together with phase 6.
*Exit*: both apps play the corpus against dev.

*Done on the branch (2026-11-26), not deployed:* the TV plays the video page's
signed manifests — DASH (`family=vp9,avc`, HLS as its fallback) on Android
TV, HLS on tvOS, HLS for live and DVR — with one player; the muxed/split
sources and the second audio player are gone. Its audio-language choice and
quality ceilings come from the video page's new `audioLanguages` and
`qualities` and narrow the DASH manifest (`lang=`, `maxHeight=`, added to the
gateway). Images go through `/media/img` (cards: `hqdefault` under a cover
crop). iOS plays the signed HLS once the detail arrives. Both rename Trending
to Live. Both typecheck (dependencies installed with `--ignore-scripts`, for
the check only); every URL the TV builds answers 200 from a local gateway.
*Left:* at the cutover (phase 6), build the TV on gloob and iOS, and play the
corpus on the devices.

**Phase 6 — cutover.**
Deploy `web` + `gateway` on naggon, Caddy `/media/*` route (with HTTP/3), remove the `owntube-media` host, migrate (no user data
moves; web drops `video_cache`). Remove the Invidious, Postgres, companion and
warmer containers; archive `mdbraber/invidious` and the companion tree; delete
`check-upstream.ts`, `setup-invidious.sh` and the Invidious docs. Rollback =
previous images + compose file, kept for two weeks. Order: back up prod's
database; build the web and gateway images; swap; the owner plays the corpus
on TV, iPhone and Safari; roll back within minutes if something breaks.

*Cut over 2026-11-26* (prod `main` = 7e10a41, compose web + gateway, warmer
sidecar and `owntube-media` host gone). Prod was down ~10 minutes: Docker
created the gateway's bind-mounted `/var/data/owntube-gateway` as the remapped
container root (host uid 1000), and the gateway's `node` user (host uid 101000
under `userns-remap: docker`) could not create `/data/cache`; `chown
101000:101000` fixed it. Verified on prod: e2e 8/8 (DASH playback, nothing
off-site), `/trending` → `/live`, warmer and publisher running. Invidious,
companion and Postgres still run for the two-week rollback window.
*Exit*: a week of normal use with no fallbacks needed.

## Decisions

Made 2026-11-26:

1. **Trending → Live.** Invidious's `/trending` was YouTube's Live channel tab
   all along (YouTube removed the aggregated Trending page). OwnTube calls it
   Live: the route, the tRPC router, the warmer and the UI label. The gateway
   exposes `browse.live()`.
2. **VOD transport: measure.** SABR vs byte-range over real use in phase 2
   (startup, seek latency, failures, PO-token dependency); one becomes the
   default and the other stays only if a content kind needs it.
3. **googlevideo**: the plan was to upstream the companion's 4.1.1 patches and
   keep a fork meanwhile. Not needed: googlevideo 5.0.1 (unpatched, from npm)
   does what they did, and SABR reads through it are byte-identical to the file.
4. **One host**, confirmed by the Safari test on `owntube-dev` (2026-11-26).
   `/media/*` is routed to the gateway.
5. **Hono** on `@hono/node-server`.

Open:

6. **PO token engine** for the third transport step (on-demand Chromium or
   on-demand Camoufox), decided by measuring it when that step is built.
7. **Transport order** (decided): VISIONOS byte-range, then VISIONOS SABR,
   then WEB SABR with a PO token. See phase 1.
8. **Age-restricted videos**: not supported for now (they need a signed-in
   account).

## Risks

- **YouTube breaks things mid-migration.** Prod stays on the old stack until
  phase 6; the fixture corpus makes breakage visible as a test diff.
- **Egress on a new runtime.** Address binding and /64 flagging are the parts
  that only fail live; phase 1's exit requires them on dev before anything else.
- **Losing upstream fixes.** Watch iv-org/invidious-companion and youtubei.js
  releases; the libraries carry most of the YouTube-tracking work and we keep
  using them directly.
- **Size.** This is a large change for one maintainer; the phases are ordered so
  each one is testable on dev before the next starts.
