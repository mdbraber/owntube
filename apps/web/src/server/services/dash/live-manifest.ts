/**
 * Live broadcasts, played as YouTube's own dynamic DASH manifest.
 *
 * Nothing else works for live: Invidious returns no `hlsUrl`, the companion's
 * `/api/manifest/dash` builds an empty MPD (live formats have no byte ranges),
 * and the WEB-client live format URLs 403 on every path. What does work is the
 * native `dashManifestUrl` from an ANDROID_VR session, which invidious-companion
 * serves at `/sabr/<id>/manifest.mpd` (its `lib/sabr/live.ts`) with each
 * `<BaseURL>` rewritten to a path on the companion that it proxies to
 * googlevideo — the addresses are IP-locked to the server.
 *
 * This module fetches that manifest, points its BaseURLs at our own
 * `/dash/<id>/live/<rep>/` segment proxy (so the browser only talks to the
 * media origin, like `/dvr`), and reshapes it into something dash.js plays —
 * see `segmentListToTemplate`.
 */
import {
  companionCheckParam,
  companionSabrUrl,
  withCompanionCheck,
} from "@/server/services/companion";

/**
 * dash.js polls every 5s per viewer; the companion caches YouTube's manifest
 * for its own TTL anyway. This only coalesces concurrent viewers and tabs.
 */
const MANIFEST_TTL_MS = 2_000;
const FETCH_TIMEOUT_MS = 15_000;

/** Init segment path, relative to each Representation's rewritten BaseURL. */
export const LIVE_INIT_PATH = "init";

/** The companion's rewritten BaseURL: `live/<check>/<index>/`. */
const COMPANION_BASE_URL_RE = /^live\/[^/]+\/(\d{1,3})\/$/;

const cache = new Map<string, { at: number; mpd: Promise<string | null> }>();

async function fetchFreshLiveManifest(videoId: string): Promise<string | null> {
  const url = companionSabrUrl(videoId, "manifest.mpd");
  if (!url) return null;
  try {
    const r = await fetch(withCompanionCheck(url, videoId), {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      await r.body?.cancel?.();
      return null;
    }
    const mpd = await r.text();
    // With no native manifest to proxy, the companion redirects to its
    // `/api/manifest/dash` route, which answers 200 with an empty static MPD
    // for live. Only a dynamic manifest with representations is usable.
    if (!/<MPD\b[^>]*\btype="dynamic"/.test(mpd)) return null;
    if (!mpd.includes("<Representation")) return null;
    return mpd;
  } catch {
    return null;
  }
}

/** The companion's live manifest, as fetched (BaseURLs still companion-relative). */
export function fetchCompanionLiveManifest(
  videoId: string,
  force = false,
): Promise<string | null> {
  const hit = cache.get(videoId);
  if (!force && hit && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.mpd;
  const mpd = fetchFreshLiveManifest(videoId);
  cache.set(videoId, { at: Date.now(), mpd });
  // A failure must not be served from cache for the TTL.
  void mpd.then((m) => {
    if (!m && cache.get(videoId)?.mpd === mpd) cache.delete(videoId);
  });
  return mpd;
}

/**
 * Point every `<BaseURL>` at `/dash/<id>/live/<index>/`. Returns null when a
 * BaseURL isn't the companion's `live/<check>/<index>/` shape — anything else
 * (e.g. a raw googlevideo address) is unfetchable from the browser.
 *
 * Root-relative on purpose: dash.js resolves it against the manifest URL, which
 * is already on the media origin, and the relative segment paths then resolve
 * beneath it.
 */
export function rewriteLiveManifestBaseUrls(
  mpd: string,
  videoId: string,
): string | null {
  let ok = true;
  let count = 0;
  const out = mpd.replace(
    /<BaseURL>([^<]*)<\/BaseURL>/g,
    (_whole, url: string) => {
      const index = COMPANION_BASE_URL_RE.exec(url.trim())?.[1];
      if (index === undefined) {
        ok = false;
        return _whole;
      }
      count++;
      return `<BaseURL>/dash/${encodeURIComponent(videoId)}/live/${index}/</BaseURL>`;
    },
  );
  return ok && count > 0 ? out : null;
}

type TimelineEntry = { t: number; d: number };

/**
 * Parse `<S t? d r?/>` entries into one entry per segment. An untimed first
 * `<S>` starts at `origin`.
 */
function flattenTimeline(
  timeline: string,
  origin: number,
): TimelineEntry[] | null {
  const out: TimelineEntry[] = [];
  let time = origin;
  for (const m of timeline.matchAll(/<S\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const num = (name: string) => {
      const v = new RegExp(`\\b${name}="(-?\\d+)"`).exec(attrs)?.[1];
      return v === undefined ? undefined : Number(v);
    };
    const t = num("t");
    const d = num("d");
    const r = num("r") ?? 0;
    // A negative repeat ("until the next update") has no fixed count.
    if (d === undefined || d <= 0 || r < 0) return null;
    if (t !== undefined) time = t;
    for (let i = 0; i <= r; i++) {
      out.push({ t: time, d });
      time += d;
    }
  }
  return out;
}

/** Re-encode entries as `<S>` runs; the first carries an explicit `t`. */
function encodeTimeline(entries: TimelineEntry[]): string {
  let xml = "";
  let i = 0;
  while (i < entries.length) {
    const first = entries[i];
    if (!first) break;
    let run = 1;
    while (
      i + run < entries.length &&
      entries[i + run]?.d === first.d &&
      entries[i + run]?.t === first.t + run * first.d
    ) {
      run++;
    }
    const prev = entries[i - 1];
    const contiguous = prev !== undefined && prev.t + prev.d === first.t;
    const t = contiguous ? "" : ` t="${first.t}"`;
    xml += `<S${t} d="${first.d}"${run > 1 ? ` r="${run - 1}"` : ""}/>`;
    i += run;
  }
  return xml;
}

/** YouTube's live segment path: `sq/<number>/<suffix>` (suffix `lmt/1`). */
const LIVE_SEGMENT_URL_RE = /^sq\/(\d+)\/([\w./-]+)$/;

/**
 * Reshape YouTube's live manifest into a `SegmentTemplate` one dash.js plays.
 * Null when it doesn't have the shape this relies on.
 *
 * YouTube lists every segment: one Period whose `SegmentList` carries the
 * `SegmentTimeline`, and per Representation a `<SegmentList>` of
 * `<SegmentURL media="sq/N/lmt/1"/>`, N counting up from `startNumber`. Two
 * things about that don't work in dash.js:
 *
 * - **Its SegmentList support ignores the timeline**: it maps time to segment
 *   by `startNumber` and a fixed duration, and the per-Representation lists
 *   carry no `startNumber` — so it fetches from the oldest segment while the
 *   playhead sits at the live edge, and never catches up. The same segments as
 *   `SegmentTemplate media="sq/$Number$/lmt/1"` with the timeline go through
 *   its well-trodden live path (and shrink the ~1MB manifest to a few KB).
 * - **The timeline's anchor.** The manifest is a sliding window re-anchored on
 *   every fetch: `Period@start` and `presentationTimeOffset` both equal the
 *   oldest segment's time, and the first `<S>` has no `t`. YouTube means the
 *   timeline to start at `presentationTimeOffset` (each segment's `tfdt` is
 *   exactly `sq × duration`); dash.js would start it at 0, placing every
 *   segment `presentationTimeOffset` early. Rebasing to `Period@start=0` and
 *   `presentationTimeOffset=0` with an explicit first `t` makes presentation
 *   time equal media time, and keeps the Period stable while the window slides.
 *
 * Each segment is self-initializing, so the template names our own init route
 * (`LIVE_INIT_PATH`): with no initialization, dash.js requests the BaseURL
 * itself, which googlevideo answers with a whole media segment.
 */
export function segmentListToTemplate(mpd: string): string | null {
  const periods = [...mpd.matchAll(/<Period\b[^>]*>/g)];
  const periodTag = periods[0]?.[0];
  if (periods.length !== 1 || !periodTag) return null;

  const periodListRe =
    /<SegmentList\b([^>]*)>\s*<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>\s*<\/SegmentList>/;
  const periodList = periodListRe.exec(mpd);
  if (!periodList) return null;
  const listAttrs = periodList[1] ?? "";
  const attr = (name: string, fallback: string) =>
    Number(new RegExp(`\\b${name}="(\\d+)"`).exec(listAttrs)?.[1] ?? fallback);
  const timescale = attr("timescale", "1");
  const startNumber = attr("startNumber", "1");
  const pto = attr("presentationTimeOffset", "0");
  if (
    !(timescale > 0) ||
    !Number.isFinite(startNumber) ||
    !Number.isFinite(pto)
  ) {
    return null;
  }
  const entries = flattenTimeline(periodList[2] ?? "", pto);
  if (!entries || entries.length === 0) return null;
  const timeline = `<SegmentTimeline>${encodeTimeline(entries)}</SegmentTimeline>`;

  const rebasedPeriodTag = periodTag
    .replace(/\s*\bstart="[^"]*"/, "")
    .replace(/^<Period\b/, '<Period start="PT0S"');

  let ok = true;
  const out = reanchorAvailabilityStart(mpd, periodTag, entries, timescale)
    .replace(periodList[0], "")
    .replace(periodTag, rebasedPeriodTag)
    .replace(
      /(<Representation\b[^>]*>[\s\S]*?)<SegmentList>([\s\S]*?)<\/SegmentList>/g,
      (whole, head: string, body: string) => {
        const medias = [
          ...body.matchAll(/<SegmentURL\b[^>]*\bmedia="([^"]+)"/g),
        ].map((m) => LIVE_SEGMENT_URL_RE.exec(m[1] ?? ""));
        const suffix = medias[0]?.[2];
        // One SegmentURL per timeline entry, numbered in order, one suffix —
        // exactly what a `$Number$` template can express.
        if (
          !suffix ||
          medias.length !== entries.length ||
          medias.some(
            (m, i) => !m || Number(m[1]) !== startNumber + i || m[2] !== suffix,
          )
        ) {
          ok = false;
          return whole;
        }
        return (
          `${head}<SegmentTemplate timescale="${timescale}" ` +
          `presentationTimeOffset="0" startNumber="${startNumber}" ` +
          `media="sq/$Number$/${suffix}" initialization="${LIVE_INIT_PATH}">` +
          `${timeline}</SegmentTemplate>`
        );
      },
    );
  return ok && !out.includes("<SegmentList") ? out : null;
}

/**
 * Set `availabilityStartTime` to the wall-clock time of media time 0, so that
 * dash.js's live edge (now − availabilityStartTime) lands on the newest
 * segments.
 *
 * YouTube's own value only fits a stream whose media timeline started with it.
 * A long-running (24/7) stream keeps counting media time across encoder
 * reconnects while `availabilityStartTime` jumps to the reconnect: seen with
 * segments at ~195 days of media time and an `availabilityStartTime` of 18
 * hours ago, which put the live edge half a year before the first segment —
 * dash.js loaded the init segments and never requested media. The Period's
 * `yt:segmentIngestTime` (when the first listed segment was ingested) is a
 * reliable anchor for any stream. Without it the manifest is left alone.
 */
function reanchorAvailabilityStart(
  mpd: string,
  periodTag: string,
  entries: TimelineEntry[],
  timescale: number,
): string {
  const ingest = /\byt:segmentIngestTime="([^"]+)"/.exec(periodTag)?.[1];
  const first = entries[0];
  if (!ingest || !first) return mpd;
  // YouTube writes UTC times without a zone designator.
  const ingestMs = Date.parse(
    /Z|[+-]\d\d:?\d\d$/.test(ingest) ? ingest : `${ingest}Z`,
  );
  if (!Number.isFinite(ingestMs)) return mpd;
  const ast = new Date(ingestMs - (first.t / timescale) * 1000).toISOString();
  return mpd.replace(
    /(<MPD\b[^>]*?\bavailabilityStartTime=")[^"]*"/,
    `$1${ast}"`,
  );
}

/** The manifest the browser gets: segments via our proxy, as a template. */
export async function buildLiveManifest(
  videoId: string,
): Promise<string | null> {
  const mpd = await fetchCompanionLiveManifest(videoId);
  if (!mpd) return null;
  const rewritten = rewriteLiveManifestBaseUrls(mpd, videoId);
  return rewritten ? segmentListToTemplate(rewritten) : null;
}

/**
 * The companion URL for one live segment. The companion only serves segments
 * for a manifest it currently holds — callers re-fetch the manifest and retry
 * on a 404 (e.g. after a companion restart).
 */
export function companionLiveSegmentUrl(
  videoId: string,
  rep: string,
  tail: string,
): string | null {
  // `check` travels in the path: relative SegmentURL resolution would drop a
  // query string, so the companion's live route reads it from there.
  const check = companionCheckParam(videoId) ?? "-";
  return companionSabrUrl(
    videoId,
    `live/${encodeURIComponent(check)}/${rep}/${tail}`,
  );
}

/**
 * The newest segment path (`sq/N/lmt/M`) the companion's manifest lists for
 * the Representation at BaseURL index `rep` — any segment carries the init
 * boxes, and the newest is the one certain to still be available.
 */
export function newestLiveSegmentPath(mpd: string, rep: string): string | null {
  for (const m of mpd.matchAll(
    /<Representation\b[^>]*>([\s\S]*?)<\/Representation>/g,
  )) {
    const body = m[1] ?? "";
    const base = /<BaseURL>([^<]*)<\/BaseURL>/.exec(body)?.[1]?.trim() ?? "";
    if (COMPANION_BASE_URL_RE.exec(base)?.[1] !== rep) continue;
    const medias = [...body.matchAll(/<SegmentURL\b[^>]*\bmedia="([^"]+)"/g)];
    return medias[medias.length - 1]?.[1] ?? null;
  }
  return null;
}

/**
 * An init segment cut from a self-initializing one: the leading `ftyp` and
 * `moov` boxes, without the `emsg`/`moof`/`mdat` media that follow. Null when
 * there's no `moov` to cut.
 */
export function initSegmentFromSelfInitializing(
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let end = 0;
  let sawMoov = false;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    // 0 (to end of file) and 1 (64-bit size) never occur in these boxes.
    if (size < 8 || offset + size > bytes.byteLength) break;
    if (type !== "ftyp" && type !== "moov") break;
    if (type === "moov") sawMoov = true;
    offset += size;
    end = offset;
  }
  return sawMoov ? bytes.slice(0, end) : null;
}

/**
 * A self-initializing segment's media alone: from its first `moof` (or `styp`)
 * on, without the leading `ftyp`, `moov` and `emsg`. HLS wants fMP4 media
 * segments to be just that, with the init in `EXT-X-MAP`; AVPlayer fails a
 * stream whose segments repeat the `moov` (see hls/live.ts). The bytes as
 * they are when no `moof` follows.
 */
export function mediaPartOfSelfInitializing(
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "moof" || type === "styp") return bytes.slice(offset);
    if (size < 8 || offset + size > bytes.byteLength) break;
    offset += size;
  }
  return bytes.slice();
}
