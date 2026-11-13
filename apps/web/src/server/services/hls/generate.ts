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

import { isYoutubeFamilyHostname } from "@/lib/invidious-proxy";

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

/** Public instance base the *browser* can reach, for direct segment mode. */
function invidiousPublicBase(): string {
  return (
    process.env.INVIDIOUS_PUBLIC_BASE_URL ??
    process.env.INVIDIOUS_BASE_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Browser-direct segment URL that NEVER points at googlevideo (those URLs are
 * IP-locked and the browser must not fetch them): googlevideo stream URLs are
 * rewritten to the instance's companion proxy
 * (`<instance>/companion/videoplayback?…&host=<googlevideo-host>` — serves
 * `Access-Control-Allow-Origin: *` and answers Range preflights), and
 * instance-hosted `/videoplayback` URLs move onto the same companion path.
 * Returns null when no browser-reachable base is configured.
 */
export function companionDirectSegmentUri(url: string): string | null {
  try {
    const u = new URL(url);
    if (isYoutubeFamilyHostname(u.hostname)) {
      const base = invidiousPublicBase();
      if (!base) return null;
      const params = new URLSearchParams(u.search);
      params.set("host", u.hostname);
      return `${base}/companion/videoplayback?${params.toString()}`;
    }
    // Instance-minted local URL (`/videoplayback?…&host=…`): prefer the
    // companion path — CORS-enabled and faster than Invidious's legacy proxy.
    if (
      u.pathname === "/videoplayback" &&
      new URLSearchParams(u.search).has("host")
    ) {
      return `${u.origin}/companion/videoplayback${u.search}`;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Segment/init URI for a media playlist. Default: rewrite the absolute upstream
 * stream URL to OwnTube's same-origin `/stream/…` proxy path. With
 * INVIDIOUS_DIRECT_HLS_SEGMENTS=true: point at Invidious/companion directly
 * (CORS `*`) so segments skip our Node proxy — never at googlevideo.
 */
export function segmentUri(url: string): string {
  if (process.env.INVIDIOUS_DIRECT_HLS_SEGMENTS === "true") {
    const direct = companionDirectSegmentUri(url);
    if (direct) return direct;
  }
  try {
    const u = new URL(url);
    return `/stream${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * A caption track as Invidious reports it on `/api/v1/videos`. The language
 * arrives as `language_code`; the camelCase spelling is only our own shape, so
 * both are accepted (see mapInvidiousCaptions).
 */
export type InvidiousCaption = {
  label?: string;
  language_code?: string;
  languageCode?: string;
  url?: string;
};

type VideoPayload = {
  formats: AdaptiveFormat[];
  captions: InvidiousCaption[];
};

async function fetchVideoPayloadUncached(
  videoId: string,
): Promise<VideoPayload> {
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
    const j = (await r.json()) as {
      adaptiveFormats?: AdaptiveFormat[];
      captions?: InvidiousCaption[];
    };
    return { formats: j.adaptiveFormats ?? [], captions: j.captions ?? [] };
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
const videoPayloadCache = new Map<
  string,
  { at: number; payload: Promise<VideoPayload> }
>();

function fetchVideoPayload(videoId: string): Promise<VideoPayload> {
  const hit = videoPayloadCache.get(videoId);
  if (hit && Date.now() - hit.at < ADAPTIVE_CACHE_TTL_MS) return hit.payload;
  const payload = fetchVideoPayloadUncached(videoId).catch((e) => {
    // Don't cache failures: let the next request retry.
    videoPayloadCache.delete(videoId);
    throw e;
  });
  videoPayloadCache.set(videoId, { at: Date.now(), payload });
  return payload;
}

export function fetchAdaptiveFormats(
  videoId: string,
): Promise<AdaptiveFormat[]> {
  return fetchVideoPayload(videoId).then((p) => p.formats);
}

/**
 * Caption tracks from the same `/api/v1/videos` response the formats come from,
 * so the DASH manifest can advertise subtitles without a second round trip.
 */
export function fetchVideoCaptions(
  videoId: string,
): Promise<InvidiousCaption[]> {
  return fetchVideoPayload(videoId).then((p) => p.captions);
}

/** Stream URLs embed `dur=<seconds>`; cheaper than a second detail fetch. */
export function durationSecondsFromFormats(af: AdaptiveFormat[]): number {
  for (const f of af) {
    const m = /[?&]dur=([\d.]+)/.exec(f.url ?? "");
    if (m?.[1]) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 0;
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

/**
 * Language/track hints googlevideo encodes in the stream URL's `xtags`
 * parameter (colon-separated pairs), e.g.
 * `acont=original:lang=nl-NL` or `acont=dubbed-auto:drc=1:lang=en-US`.
 *
 * This — not the format list's metadata — is the only reliable signal this
 * Invidious build gives us for multi-audio videos: the dubbed rows carry the
 * SAME itag as the original and differ only in `xtags`.
 */
export function audioXtagsOf(url: string): {
  /** Exact decoded xtags value; re-identifies the row in media.m3u8. */
  raw: string | null;
  lang: string | null;
  acont: string | null;
  /** Dynamic-range-compressed duplicate of another row. */
  drc: boolean;
} {
  try {
    const raw = new URL(url).searchParams.get("xtags");
    if (!raw) return { raw: null, lang: null, acont: null, drc: false };
    let lang: string | null = null;
    let acont: string | null = null;
    let drc = false;
    for (const pair of raw.split(":")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      if (k === "lang" && v) lang = v;
      else if (k === "acont" && v) acont = v;
      else if (k === "drc") drc = v === "1";
    }
    return { raw, lang, acont, drc };
  } catch {
    return { raw: null, lang: null, acont: null, drc: false };
  }
}

export type AudioTrackVariant = {
  format: AdaptiveFormat;
  /** BCP-47-ish tag from xtags (e.g. "nl-NL"); null for single-track videos. */
  lang: string | null;
  /** YouTube's original audio (`acont=original`), vs a translated dub. */
  isOriginal: boolean;
  /** The manifest default: the original when present, else the first track. */
  isDefault: boolean;
  /** Exact xtags of the chosen row (see {@link audioXtagsOf}). */
  xtags: string | null;
};

/**
 * One playable AAC track per audio language, ORIGINAL FIRST AND DEFAULT.
 *
 * YouTube lists auto-dubs before the original on some videos (observed:
 * `acont=dubbed-auto:lang=en-US` rows precede `acont=original:lang=nl-NL`),
 * so "first AAC row" — the old rule — picked the dub. Rows are grouped by
 * xtags language+acont (same itag across languages!), each group keeps its
 * best row (non-`drc` over drc, then bitrate), and the original group is
 * moved to the front so every consumer of manifest order gets it by default.
 */
export function pickAudioTracks(af: AdaptiveFormat[]): AudioTrackVariant[] {
  type Row = { f: AdaptiveFormat; x: ReturnType<typeof audioXtagsOf> };
  const rows: Row[] = af
    .filter((f) => /mp4a/.test(f.type) && f.url && f.init && f.index)
    .map((f) => ({ f, x: audioXtagsOf(f.url) }));

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    // Rows without xtags all describe the same lone track (multi-host repeats).
    const key = r.x.raw ? `${r.x.lang ?? ""}|${r.x.acont ?? ""}` : "";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const chosen = Array.from(groups.values()).map(
    (g) =>
      g.sort(
        (a, b) =>
          (a.x.drc ? 1 : 0) - (b.x.drc ? 1 : 0) ||
          Number(b.f.bitrate) - Number(a.f.bitrate),
      )[0] as Row,
  );
  chosen.sort(
    (a, b) =>
      (a.x.acont === "original" ? 0 : 1) - (b.x.acont === "original" ? 0 : 1),
  );

  return chosen.map((r, i) => ({
    format: r.f,
    lang: r.x.lang,
    isOriginal: r.x.acont === "original" || chosen.length === 1,
    isDefault: i === 0,
    xtags: r.x.raw,
  }));
}

/**
 * English display name for a track ("Dutch (Original)"). Manifest-embedded, so
 * viewer-locale localization happens client-side from the `lang` tag; this is
 * the fallback players show when they don't localize.
 */
export function audioTrackName(t: AudioTrackVariant, index: number): string {
  const primary = t.lang?.split(/[-_]/)[0]?.toLowerCase();
  let name: string | undefined;
  if (primary) {
    try {
      name = new Intl.DisplayNames(["en"], { type: "language" }).of(primary);
    } catch {
      name = undefined;
    }
    name = name ?? t.lang?.toUpperCase();
  }
  if (!name) name = index === 0 ? "Audio" : `Audio ${index + 1}`;
  return t.isOriginal && t.lang ? `${name} (Original)` : name;
}

function mediaPlaylistUri(t: AudioTrackVariant): string {
  const xt = t.xtags ? `&xtags=${encodeURIComponent(t.xtags)}` : "";
  return `media.m3u8?itag=${t.format.itag}${xt}`;
}

/**
 * How `/captions/<videoId>` identifies a caption track upstream: by language
 * when known, else by label. Same rule as the DASH manifest's subtitle sets.
 */
function captionQuery(caption: InvidiousCaption): string | null {
  const lang = (caption.language_code ?? caption.languageCode)?.trim();
  if (lang) return `lang=${encodeURIComponent(lang)}`;
  const label = caption.label?.trim();
  if (label) return `label=${encodeURIComponent(label)}`;
  return null;
}

/** Quoted-string attribute values may not contain `"` or line breaks. */
function hlsAttributeText(value: string): string {
  return value.replace(/["\r\n]/g, "");
}

/**
 * One SUBTITLES rendition per caption track, so native HLS players (AVPlayer)
 * offer the captions the web player already shows. Never DEFAULT: captions
 * start off unless the viewer — or the system's closed-captions setting,
 * which honours AUTOSELECT — asks for them.
 */
export function subtitleRenditions(captions: InvidiousCaption[]): string[] {
  return captions.flatMap((caption) => {
    const query = captionQuery(caption);
    if (!query) return [];
    const lang = (caption.language_code ?? caption.languageCode)?.trim();
    const name = hlsAttributeText(caption.label?.trim() || lang || "Captions");
    const language = lang ? `,LANGUAGE="${hlsAttributeText(lang)}"` : "";
    return [
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${name}"${language},DEFAULT=NO,AUTOSELECT=YES,URI="subtitles.m3u8?${query}"`,
    ];
  });
}

/** Pure master-playlist builder (exported for tests). */
export function buildMasterPlaylist(
  videos: AdaptiveFormat[],
  audioTracks: AudioTrackVariant[],
  captions: InvidiousCaption[] = [],
): string {
  const defaultAudio =
    audioTracks.find((t) => t.isDefault) ??
    (audioTracks[0] as AudioTrackVariant);
  const audioCodec = codecsOf(defaultAudio.format.type);
  const audioBitrate = Number(defaultAudio.format.bitrate) || 0;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const [i, t] of audioTracks.entries()) {
    const name = audioTracks.length === 1 ? "Audio" : audioTrackName(t, i);
    const language = t.lang ? `,LANGUAGE="${t.lang}"` : "";
    // AUTOSELECT only on the default (original) track: Apple's native player
    // lets an AUTOSELECT=YES rendition that matches the system language beat
    // DEFAULT=YES, so an English iPhone started Dutch videos on the English
    // auto-dub. Dubs stay manually selectable (the spec requires
    // AUTOSELECT=YES on the DEFAULT=YES rendition).
    const flag = t.isDefault ? "YES" : "NO";
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${name}"${language},DEFAULT=${flag},AUTOSELECT=${flag},URI="${mediaPlaylistUri(t)}"`,
    );
  }
  const subtitles = subtitleRenditions(captions);
  lines.push(...subtitles);
  const subtitlesGroup = subtitles.length > 0 ? `,SUBTITLES="subs"` : "";
  for (const v of videos) {
    const bandwidth = (Number(v.bitrate) || 0) + audioBitrate;
    const res = v.size ? `,RESOLUTION=${v.size}` : "";
    const codecs = [codecsOf(v.type), audioCodec].filter(Boolean).join(",");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}${res},CODECS="${codecs}",AUDIO="aud"${subtitlesGroup}`,
    );
    lines.push(`media.m3u8?itag=${v.itag}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Master playlist: video variants + one audio rendition per language. */
export async function generateMasterPlaylist(videoId: string): Promise<string> {
  const af = await fetchAdaptiveFormats(videoId);
  const videos = pickVideoFormats(af);
  const audioTracks = pickAudioTracks(af);
  if (videos.length === 0 || audioTracks.length === 0) {
    throw new Error("no AVC video + AAC audio streams");
  }
  // Subtitles are best-effort, and need the duration for their playlist: a
  // caption lookup failure or an unknown duration costs the captions, not
  // the playback.
  const captions =
    durationSecondsFromFormats(af) > 0
      ? await fetchVideoCaptions(videoId).catch(() => [] as InvidiousCaption[])
      : [];
  return buildMasterPlaylist(videos, audioTracks, captions);
}

/**
 * Pure subtitle-playlist builder (exported for tests): the whole WebVTT file
 * from `/captions/<videoId>` as one segment spanning the video. HLS wants
 * subtitles as a media playlist; one segment is enough for VOD, and AVPlayer
 * lines its cues up with the video's own timeline.
 */
export function buildSubtitlePlaylist(
  videoId: string,
  query: string,
  durationSeconds: number,
): string {
  const duration = durationSeconds.toFixed(3);
  return `${[
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(durationSeconds)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXTINF:${duration},`,
    `/captions/${encodeURIComponent(videoId)}?${query}`,
    "#EXT-X-ENDLIST",
  ].join("\n")}\n`;
}

/** Subtitle playlist for the caption track `lang` (or, lacking one, `label`) names. */
export async function generateSubtitlePlaylist(
  videoId: string,
  caption: { lang?: string; label?: string },
): Promise<string> {
  const query = captionQuery({
    languageCode: caption.lang,
    label: caption.label,
  });
  if (!query) throw new Error("missing lang or label");
  const durationSeconds = durationSecondsFromFormats(
    await fetchAdaptiveFormats(videoId),
  );
  if (durationSeconds <= 0) throw new Error("unknown video duration");
  return buildSubtitlePlaylist(videoId, query, durationSeconds);
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

/**
 * Media playlist for one stream (itag): EXT-X-MAP + byte-range fragments.
 *
 * `xtags` disambiguates multi-language audio: every language of a video's AAC
 * audio shares itag 140 and differs only in the URL's xtags, so an itag-only
 * lookup would always resolve to the first row (possibly a dub).
 */
export async function generateMediaPlaylist(
  videoId: string,
  itag: string,
  xtags?: string | null,
): Promise<string> {
  const af = await fetchAdaptiveFormats(videoId);
  const f = af.find(
    (x) =>
      String(x.itag) === String(itag) &&
      (!xtags || audioXtagsOf(x.url).raw === xtags),
  );
  if (!f || !f.init || !f.index) throw new Error(`itag ${itag} not found`);
  const sidx = await getSidx(
    videoId,
    xtags ? `${itag}:${xtags}` : itag,
    f.url,
    f.index,
  );
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
