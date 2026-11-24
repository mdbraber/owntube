# Live and post-live DVR playback

How OwnTube plays live broadcasts and ended-but-not-yet-VOD streams, why each
piece is shaped the way it is, and how to test, debug, deploy and roll back.
Written 2026-09-21, when this started working end to end.

## Summary

| stream state | Invidious says | OwnTube route | source of segments |
|---|---|---|---|
| **live** | `liveNow: true` | `/dash/<id>/live.mpd` + `/dash/<id>/live/<rep>/…` | companion `/sabr` (YouTube's own live manifest, ANDROID_VR session) |
| **post-live DVR** (ended, not yet converted) | `isPostLiveDvr: true` | `/dash/<id>/manifest.mpd` (falls back) + `/dvr/<id>/<rep>/<sq>` | companion `/api/manifest/dash` (YouTube.js SegmentTemplate) |
| VOD | — | `/hls`, `/dash/<id>/manifest.mpd` (synthesized) | companion `/videoplayback`; optionally companion `/sabr` (see [VOD via SABR](#vod-via-sabr)) |

Both live paths depend on invidious-companion. OwnTube never calls YouTube's
InnerTube API itself: that stays behind the companion (see
`INVIDIOUS-BOUNDARY-PLAN.md`). The companion build we run carries our own
patches; see `PATCHES.md` in the companion repo.

## Live: what doesn't work, and what does

Probed from the server's IP; don't re-try these without a reason to think
YouTube changed:

- **Invidious `hlsUrl`**: sometimes present for a live stream (it depends on
  which YouTube client the companion fell back to), but its segments 403 when
  fetched from the server.
- **Companion `/api/manifest/dash` for live**: 200 with an empty
  `<Period/>` and `mediaPresentationDuration="PTNaNS"`. Live formats have no
  byte ranges, so there is nothing to build from.
- **WEB-client live format URLs** (`c=WEB`, `rqh=1`, `sefc=1`): 403 on every
  path. YouTube wants SABR for these.
- **iOS client**: no manifests at all; its plain format URLs carry no PO token
  and work for ~30–45 s, then 403 for good.
- **TV / ANDROID_VR without a visitorData**: "Sign in to confirm you're not a
  bot".
- **ANDROID_VR + visitorData, HLS**: manifest yes, segments 403.
- **ANDROID_VR + visitorData, DASH: works.** `dashManifestUrl` is a
  `type="dynamic"` manifest, 4 h rewind window, H.264 + AAC to 1080p60, and
  its segments (`<BaseURL>sq/<N>/lmt/1`) keep serving.

The companion's `/sabr/<id>/manifest.mpd` (`src/lib/sabr/live.ts`) fetches that
manifest from an ANDROID_VR session and rewrites each `<BaseURL>` to
`live/<check>/<index>/` on the companion, whose
`/sabr/<id>/live/<check>/<rep>/*` route proxies to the IP-locked googlevideo
address.

## Live: the OwnTube side

`apps/web/src/server/services/dash/live-manifest.ts` fetches the companion's
manifest (signed with `check=`, 2 s coalescing cache) and reshapes it before
dash.js sees it. Each transform fixes something that on its own stopped
playback:

1. **BaseURLs → `/dash/<id>/live/<index>/`.** The browser only ever talks to
   our media origin, like `/dvr`. Root-relative, so the relative
   `sq/N/lmt/1` segment paths resolve beneath it.
2. **`SegmentList` → `SegmentTemplate media="sq/$Number$/lmt/1"`.** dash.js's
   SegmentList support ignores the `SegmentTimeline`: it maps time to segment
   by `startNumber` and a fixed duration, and YouTube's per-Representation
   lists carry no `startNumber`. It fetched from the oldest segment while the
   playhead sat at the live edge. The template goes through dash.js's normal
   live path, and the manifest shrinks from ~1.1 MB to ~4 KB.
3. **Timeline anchoring.** YouTube's manifest is a sliding window re-anchored
   on every fetch: `Period@start` and `presentationTimeOffset` both equal the
   oldest segment's time and the first `<S>` has no `t`. YouTube means that
   timeline to start at `presentationTimeOffset` (a segment's `tfdt` is exactly
   `sq × 5 s`); dash.js starts an untimed timeline at 0, which put every segment
   hours before its media. We rebase to `Period@start=0`,
   `presentationTimeOffset=0` with an explicit first `t`, so presentation time
   equals media time and stays stable while the window slides.
4. **An explicit init segment.** Without `initialization`, dash.js requests the
   BaseURL itself, which googlevideo answers with a whole media segment. The
   template names `init`, served by `/dash/<id>/live/<rep>/init` as the
   `ftyp`+`moov` of the newest segment (live segments are self-initializing),
   cached per representation for 10 min.

If the manifest doesn't have the expected shape, `segmentListToTemplate`
returns null and the route answers 502 rather than serve something dash.js will
mis-play.

Segments: `/dash/<id>/live/<rep>/sq/<n>/lmt/<n>` → companion. The companion
only serves segments for a manifest it currently holds, so a 404 (e.g. after a
companion restart) re-fetches the manifest and retries once.

Player side:

- `buildWatchPlayback` (`lib/pick-playback.ts`) always returns `dash-live` for
  `isLive`, even when Invidious offers an `hlsUrl`.
- The payload stays `mode: "hls"` with the `.mpd` as `src`;
  `video-player.tsx` sends a live manifest (`isLiveDashManifestUrl`) to
  `LiveBlock`, which runs dash.js with a quality menu.
- `useDashPlayback` turns off two VOD tricks when the source is the live
  manifest: fast switching and the cheap-rung fast seek. Both *replace*
  buffered media; on live they knocked out the segment under the playhead at
  startup, dash.js moved on without re-fetching it, and playback never began.
- With no resume point the hook passes `NaN`, not `0`, as the start time. For a
  dynamic manifest `0` means the oldest listed segment.

## Post-live DVR

An ended broadcast that YouTube hasn't converted to VOD yet has no
byte-range-indexed formats, so `/hls` and the synthesized `/dash` can't be
built. `/dash/<id>/manifest.mpd` then falls back to the companion's own
`/api/manifest/dash` (a static SegmentTemplate manifest built by YouTube.js)
and rewrites its segment URLs to `/dvr/<id>/<rep>/<sq>`
(`server/services/dash/dvr-manifest.ts`). `/dvr` resolves the current upstream
URL per request from a 60 s cache of that manifest, and re-fetches it on a 403,
since the po_token in those URLs ages out.

This needs our companion patches: `*.c.youtube.com` segment hosts, forwarding
the `X-Head-*` headers YouTube.js reads for the segment count, and an uncached
player response for live/DVR.

## VOD via SABR

Off by default. `INVIDIOUS_COMPANION_SABR_VOD` (OwnTube) picks where
`/dash/<id>/manifest.mpd` and `/hls/<id>/master.m3u8` come from for an
ordinary video:

| value | behaviour |
|---|---|
| `off` (default) | synthesized from YouTube's byte-range `adaptiveFormats` (`dash/generate.ts`): VP9/AV1 to 4K, plus the AVC ladder |
| `fallback` | as `off`; when that can't be built, the companion's `/sabr/<id>/manifest.mpd` is tried before the post-live DVR route |
| `always` | the companion's SABR connector first, byte-range formats when it has nothing |

The connector (`sabr-vod.ts`) pulls the video over YouTube's SABR protocol on
the companion and cuts it into a `SegmentTemplate` manifest. Its default
ladder is H.264 + AAC to 1080p (decodes everywhere). Since 2026-11-24 it also
serves codec-family ladders past 1080p:

- **DASH** (browsers with MSE): the player's codec probe asks for
  `manifest.mpd?video=vp9|av01` and gets VP9 (WebM) or AV1 (fMP4) to 2160p;
  `avc` gets the default ladder.
- **HLS** (`hls/sabr.ts`; Safari on iPhone/iPad, the iOS app): one master
  lists the AV1 ladder ahead of the H.264 one. A player without an AV1
  decoder (on Apple: hardware AV1, A17 Pro / M3 and later) skips those
  variants by their `CODECS` and plays H.264 as before. VP9 can't go here:
  Apple's HLS doesn't take WebM. `INVIDIOUS_COMPANION_SABR_HLS_AV1=off` drops
  the AV1 variants. Videos without an AV1 encode stay at 1080p on Apple.

`always` shifts the per-viewer download onto the companion.

OwnTube rewrites the connector's template to `/dash/<id>/sabr/<track>/init.mp4`
and `/dash/<id>/sabr/<track>/seg-<n>.m4s` on the media origin, proxied to the
companion with a fresh `check=` per request, and swaps the companion's caption
sets (which point at its own `/api/v1/captions`) for ours on `/captions`. The
`maxHeight` and `lang` query parameters work as on the synthesized manifest
(`lang` becomes the connector's `audio=`, which needs the companion's
`SABR_POT_URL` for dubbed tracks). A 404 from the companion (it holds prepared
sessions in memory, so a restart forgets them) re-requests the manifest and
retries once; its 503 "not ready" passes through for dash.js to retry.

The synthesized HLS playlist follows the same switch (`hls/sabr.ts`): the
connector's manifest is one `SegmentTemplate` + `SegmentTimeline` per track,
so each track becomes an HLS media playlist (`/hls/<id>/sabr.m3u8?track=…`)
with `EXT-X-MAP` on `init.mp4` and one entry per `seg-<n>.m4s`, on the same
`/dash/<id>/sabr/` proxy. The master lists the ladder sharing one audio group
plus our caption renditions. Only the default audio track; no dub picker on
this path.

**Why `always` (2026-11-13).** Since the companion fell back to the
TVHTML5_SIMPLY client for stream URLs, YouTube revokes a byte-range URL after
roughly 60–75 s of fetched media: every later range 403s, hours before
`expire`, whatever address fetches it (tested with egress pinned to the URL's
`ip=`), paced or not. That is the "video stalls after a minute or so" bug on
the byte-range HLS and DASH paths, and nothing on them can recover (the
companion caches the player response, so a reload gets the same dead URL).
Through the connector, 100 consecutive 720p segments (~8.5 min of video)
came back 200 in 18 s. naggon runs `always`.

**State on 2026-09-23.** Random access through the connector depends entirely
on the SABR session's client identity, measured against four videos:

| session | start at 0 | start mid-video / seek |
|---|---|---|
| ANDROID_VR (connector's original choice) | works | refused beyond ~1 min: empty answers ×5, then a reload demand |
| WEB + Camoufox or headless-Chromium PO token | ~48 s of media, then "attestation required" (except on one video where the server reported the token verified) | same |
| **VISIONOS** (no token; what NewPipeExtractor and LibreTube stream from) | works, `STREAM_PROTECTION_STATUS` 1 on the first response | works, ~50 ms to the first segment, incl. 2300 s into a 39-min video, 720p and audio-only |

Companion commits `6b7afad`..`8ea6aec` (image
`nedworks/invidious-companion:2026.09.23-master-8ea6aec`) switched VOD
sessions to VISIONOS (live keeps ANDROID_VR for its native manifest), made
readers abort the underlying SabrStream (cancelling the reader alone left it
retrying against a closed controller, the "cannot close or enqueue" noise in
the log), handle a server reload request by re-fetching the player response
in place, pick the original audio track rather than the first dub a native
response lists, and stop a reader `SABR_AHEAD_SEGMENTS` (24) past the newest
segment a player asked for (VISIONOS serves at line speed with no
backpressure, so an unbounded reader held the rest of the video in memory).
The client constants mirror NewPipeExtractor's `ClientsConstants.java`.

Verified 2026-09-23 with that image side by side and owntube-dev on
`INVIDIOUS_COMPANION_SABR_VOD=always`: Big Buck Bunny and a 39-minute talk
with 21 dubs play from the start, seek to 120 s in about 4 s (dash.js's own
buffering; the companion answers in ~50 ms), with every segment 200 and the
companion at ~1 GB peak against a 640 MB idle baseline. (The ladder was then
H.264 to `SABR_MAX_HEIGHT`; the >1080p family ladders above came later.)

## Configuration

| where | setting | why |
|---|---|---|
| OwnTube | `INVIDIOUS_COMPANION_SECRET_KEY` | signs `check=`; must equal the companion's `SERVER_SECRET_KEY` (16 chars). Without it every companion request 400s. |
| OwnTube | `INVIDIOUS_COMPANION_INTERNAL_URL` | optional; server-side companion fetches skip the public hop. Falls back to `INVIDIOUS_PUBLIC_BASE_URL`. |
| OwnTube | `INVIDIOUS_COMPANION_SABR_VOD` | `off` (default), `fallback` or `always`: VOD through the companion's SABR connector (see [VOD via SABR](#vod-via-sabr)). |
| companion | `SERVER_VERIFY_REQUESTS=true` | guards `/sabr`, `/api/manifest/dash`, captions with `check=` |
| companion | `SABR_LIVE_MANIFEST_TTL_MS=5000` | how often it re-fetches YouTube's live manifest. The 20 s default holds the live edge back: dash.js only plays segments the manifest lists. |

The dev container reads `.env` at creation. A container created before a key
was added to `.env` doesn't have it; recreate it (`docker compose -f
docker-compose.dev.yml up -d`), a `restart-dev` isn't enough.

## Testing

Unit and route tests: `live-manifest.test.ts`, `app/dash/live-route.test.ts`,
`dvr-manifest.test.ts`, `sabr-vod.test.ts`, `app/dash/sabr-vod-route.test.ts`,
`pick-playback.test.ts`.

**A live video**: anything with `liveNow: true` in
`/api/v1/videos/<id>`. Check the chain:

```bash
M=https://owntube-media.home.nedworks.org   # or owntube-dev-media
curl -s $M/dash/<id>/live.mpd | head -c 600        # SegmentTemplate, Period start PT0S
curl -s -o seg $M/dash/<id>/live/1/sq/<n>/lmt/1    # then read its tfdt: must be n × 5 s
```

**A DVR video** only exists for a few hours after a stream ends. To find one:
list channels that are live now (Invidious
`/api/v1/search?q=live&type=video&features=live`), take the recently ended
entries of their `/api/v1/channels/<ucid>/streams` ("… hours ago"), and check
each for `isPostLiveDvr: true` in `/api/v1/videos/<id>`. Long sports and news
streams are the likeliest.

**In a browser** (Playwright's Chromium decodes H.264/AAC): open the watch page,
click the centre of the player (headless Chromium blocks unmuted autoplay), and
sample `currentTime`, `readyState`, `buffered` and
`getVideoPlaybackQuality().totalVideoFrames`. Healthy live: `readyState` 4,
`currentTime` advancing 5 s per 5 s, buffer ahead of the playhead.

## Debugging notes

What found the bugs above, in order of usefulness:

- **Check a segment's `tfdt` against the requested `sq`.** A companion bug
  returned the newest segment for *every* request (a decoded `check` compared
  against the encoded path left the segment path empty); two different `sq`
  returning the same bytes gave it away immediately.
- **Instrument MSE on the real page** with Playwright `addInitScript`: wrap
  `MediaSource.addSourceBuffer`, `SourceBuffer.appendBuffer`/`remove` and log
  `buffered` on `updateend`. Shows exactly what lands in the buffer and when.
- **A standalone harness** (a tiny server that serves the manifest through the
  real transform functions, plus dash.js from `node_modules`) separates manifest
  problems from app/player problems. It played long before the watch page did,
  which pointed at the hook, not the manifest.
- A `check` of `-` (no signature) hides bugs that only a percent-encoded real
  signature triggers. Test with the real key.

## Deploy and roll back

Prod OwnTube builds from the working tree (`/var/data/config/owntube`,
`docker compose build owntube && docker compose up -d owntube`); dev
hot-reloads from the same checkout. Before a prod build, tag the running image
for rollback, e.g. `docker tag owntube-owntube:latest
owntube-owntube:pre-<change>-<date>`.

The companion runs from `/var/data/config/invidious/docker-compose.yml`; its
image, rollback tags and build procedure are in the companion repo's
`PATCHES.md`. Swapping it affects prod Invidious and both OwnTubes: run the
smoke checks (VOD manifest, captions, `/videoplayback` range, `/sabr` live
manifest and segments) before and after.
