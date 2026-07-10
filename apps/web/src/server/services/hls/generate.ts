/**
 * Server-side VOD HLS generation from YouTube/Invidious adaptive fMP4 streams.
 *
 * YouTube serves no HLS for regular VOD (only live), so iOS Safari — which
 * plays HLS *natively* but handles MSE (dash.js/hls.js) poorly — has nothing
 * reliable to play. We synthesize a byte-range HLS manifest from the adaptive
 * streams: each stream is a single fMP4 file whose `sidx` box indexes its
 * fragments, so we emit `EXT-X-MAP` (init) + `EXT-X-BYTERANGE` fragments. iOS
 * then plays it natively; hls.js handles every other browser.
 *
 * By default segments point at OwnTube's same-origin `/invidious/videoplayback`
 * proxy (no CORS needed). With INVIDIOUS_DIRECT_HLS_SEGMENTS=true they instead
 * keep the absolute Invidious URL, so the browser streams segments straight
 * from Invidious/companion (which serves `Access-Control-Allow-Origin: *`) in a
 * single hop — the same route Invidious's own player takes — keeping our Node
 * proxy (and its mid-stream `read ETIMEDOUT` stalls) out of the segment path.
 */

const INVIDIOUS_TIMEOUT_MS = 15_000;

export type AdaptiveFormat = {
  itag: number | string;
  type: string;
  url: string;
  init: string;
  index: string;
  bitrate: number | string;
  clen?: number | string;
  size?: string; // "1280x720"
  resolution?: string;
  fps?: number;
};

function invidiousBase(): string {
  return (process.env.INVIDIOUS_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function codecsOf(type: string): string {
  return type.match(/codecs="([^"]+)"/)?.[1] ?? "";
}

/**
 * Segment/init URI for a media playlist. Default: rewrite the absolute Invidious
 * stream URL to OwnTube's same-origin `/invidious/…` proxy path. With
 * INVIDIOUS_DIRECT_HLS_SEGMENTS=true: keep the absolute Invidious URL so the
 * browser streams segments directly from Invidious/companion (CORS `*`) instead
 * of re-proxying every fragment through our Node server.
 */
export function segmentUri(url: string): string {
  if (process.env.INVIDIOUS_DIRECT_HLS_SEGMENTS === "true") return url;
  try {
    const u = new URL(url);
    return `/invidious${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

async function fetchAdaptiveFormatsUncached(
  videoId: string,
): Promise<AdaptiveFormat[]> {
  const inv = invidiousBase();
  if (!inv) throw new Error("INVIDIOUS_BASE_URL not configured");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);
  try {
    const r = await fetch(
      `${inv}/api/v1/videos/${encodeURIComponent(videoId)}${
        process.env.INVIDIOUS_USE_LOCAL !== "false" ? "?local=true" : ""
      }`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = (await r.json()) as { adaptiveFormats?: AdaptiveFormat[] };
    return j.adaptiveFormats ?? [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * A single video load fans out to master.m3u8 + one media.m3u8 per variant, all
 * within a second or two. Without caching each would re-fetch `/api/v1/videos`
 * (~1-2s upstream) — slow start and needless load on Invidious. Cache the
 * adaptive formats per videoId for a short TTL and dedupe concurrent in-flight
 * fetches by storing the Promise, so the whole manifest set shares one upstream
 * round-trip. The signed stream URLs inside stay valid for ~6h, so a long TTL
 * is safe — and it turns the ~3s cold manifest cost into ~0.3s for every
 * replay/seek/quality-switch within the window.
 */
const ADAPTIVE_CACHE_TTL_MS = 30 * 60_000;
const adaptiveFormatsCache = new Map<
  string,
  { at: number; formats: Promise<AdaptiveFormat[]> }
>();

export function fetchAdaptiveFormats(
  videoId: string,
): Promise<AdaptiveFormat[]> {
  const hit = adaptiveFormatsCache.get(videoId);
  if (hit && Date.now() - hit.at < ADAPTIVE_CACHE_TTL_MS) return hit.formats;
  const formats = fetchAdaptiveFormatsUncached(videoId).catch((e) => {
    // Don't cache failures: let the next request retry.
    adaptiveFormatsCache.delete(videoId);
    throw e;
  });
  adaptiveFormatsCache.set(videoId, { at: Date.now(), formats });
  return formats;
}

/** The `sidx` box: per-fragment byte size + duration, plus where media begins. */
export type Sidx = {
  timescale: number;
  refs: { size: number; duration: number }[];
  mediaStart: number;
};

export function parseSidx(buf: Buffer, indexStart: number): Sidx {
  let base = 0;
  if (buf.toString("ascii", 4, 8) !== "sidx") {
    const i = buf.indexOf("sidx", 0, "ascii");
    if (i < 4) throw new Error("sidx box not found");
    base = i - 4;
  }
  let o = base + 8;
  const version = buf.readUInt8(o);
  o += 4; // version + flags
  o += 4; // reference_ID
  const timescale = buf.readUInt32BE(o);
  o += 4;
  let firstOffset: number;
  if (version === 0) {
    o += 4; // earliest_presentation_time
    firstOffset = buf.readUInt32BE(o);
    o += 4;
  } else {
    o += 8;
    firstOffset = Number(buf.readBigUInt64BE(o));
    o += 8;
  }
  o += 2; // reserved
  const refCount = buf.readUInt16BE(o);
  o += 2;
  const refs: { size: number; duration: number }[] = [];
  for (let i = 0; i < refCount; i++) {
    const a = buf.readUInt32BE(o);
    o += 4;
    const dur = buf.readUInt32BE(o);
    o += 4;
    o += 4; // SAP
    refs.push({ size: a & 0x7fffffff, duration: dur / timescale });
  }
  const boxSize = buf.readUInt32BE(base);
  return {
    timescale,
    refs,
    mediaStart: indexStart + base + boxSize + firstOffset,
  };
}

async function fetchSidx(streamUrl: string, indexRange: string): Promise<Sidx> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);
  try {
    const r = await fetch(streamUrl, {
      headers: { range: `bytes=${indexRange}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (r.status !== 206 && r.status !== 200) {
      throw new Error(`sidx fetch ${r.status}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return parseSidx(buf, Number(indexRange.split("-")[0]));
  } finally {
    clearTimeout(t);
  }
}

function pickVideoFormats(af: AdaptiveFormat[]): AdaptiveFormat[] {
  // AVC only: universally decodable, including iOS native HLS.
  // Best rung FIRST: Safari's native player starts with the first variant in
  // the master playlist (and is slow to climb from a low anchor), so ascending
  // order meant playback opened — and often stayed — at 144p. hls.js ignores
  // list order (bandwidth-estimate ABR), so this only steers Safari/iOS.
  return af
    .filter((f) => /avc1/.test(f.type) && f.init && f.index)
    .sort((a, b) => Number(b.bitrate) - Number(a.bitrate));
}

function pickAudioFormat(af: AdaptiveFormat[]): AdaptiveFormat | undefined {
  // Default (first) AAC track. Multi-language audio groups are a follow-up.
  return af.find((f) => /mp4a/.test(f.type) && f.init && f.index);
}

/** Master playlist: video variants + a default AAC audio group. */
export async function generateMasterPlaylist(videoId: string): Promise<string> {
  const af = await fetchAdaptiveFormats(videoId);
  const videos = pickVideoFormats(af);
  const audio = pickAudioFormat(af);
  if (videos.length === 0 || !audio) {
    throw new Error("no AVC video + AAC audio streams");
  }
  const audioCodec = codecsOf(audio.type);
  const audioBitrate = Number(audio.bitrate) || 0;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  lines.push(
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="media.m3u8?itag=${audio.itag}"`,
  );
  for (const v of videos) {
    const bandwidth = (Number(v.bitrate) || 0) + audioBitrate;
    const res = v.size ? `,RESOLUTION=${v.size}` : "";
    const codecs = [codecsOf(v.type), audioCodec].filter(Boolean).join(",");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}${res},CODECS="${codecs}",AUDIO="aud"`,
    );
    lines.push(`media.m3u8?itag=${v.itag}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Parsed `sidx` per (videoId, itag); dedupes the byte-range fetch across the
 *  initial media-playlist request and later re-requests (quality switch, seek). */
const sidxCache = new Map<string, { at: number; sidx: Promise<Sidx> }>();

function getSidx(
  videoId: string,
  itag: string,
  streamUrl: string,
  indexRange: string,
): Promise<Sidx> {
  const key = `${videoId}:${itag}`;
  const hit = sidxCache.get(key);
  if (hit && Date.now() - hit.at < ADAPTIVE_CACHE_TTL_MS) return hit.sidx;
  const sidx = fetchSidx(streamUrl, indexRange).catch((e) => {
    sidxCache.delete(key);
    throw e;
  });
  sidxCache.set(key, { at: Date.now(), sidx });
  return sidx;
}

/** Media playlist for one stream (itag): EXT-X-MAP + byte-range fragments. */
export async function generateMediaPlaylist(
  videoId: string,
  itag: string,
): Promise<string> {
  const af = await fetchAdaptiveFormats(videoId);
  const f = af.find((x) => String(x.itag) === String(itag));
  if (!f || !f.init || !f.index) throw new Error(`itag ${itag} not found`);
  const sidx = await getSidx(videoId, itag, f.url, f.index);
  const uri = segmentUri(f.url);
  const [ia, ib] = f.init.split("-").map(Number);
  const targetDuration = Math.ceil(
    sidx.refs.reduce((m, r) => Math.max(m, r.duration), 0),
  );
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="${ib - ia + 1}@${ia}"`,
  ];
  let offset = sidx.mediaStart;
  for (const r of sidx.refs) {
    lines.push(`#EXTINF:${r.duration.toFixed(6)},`);
    lines.push(`#EXT-X-BYTERANGE:${r.size}@${offset}`);
    lines.push(uri);
    offset += r.size;
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}
