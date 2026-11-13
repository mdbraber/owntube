/**
 * VOD HLS from invidious-companion's SABR→DASH connector (`sabr-vod.ts`).
 *
 * The byte-range HLS in `generate.ts` hands players signed googlevideo URLs
 * from the companion's TV client, and YouTube revokes those after roughly a
 * minute of fetched media: every later range 403s and playback stalls. The
 * SABR connector pulls the video server-side over YouTube's own streaming
 * protocol instead and cuts it into numbered fMP4 segments, which keep coming
 * for the whole video.
 *
 * The connector only speaks DASH, but its manifest is a plain
 * SegmentTemplate + SegmentTimeline per track, so each track maps 1:1 onto an
 * HLS media playlist: EXT-X-MAP for `init.mp4`, one entry per `seg-N.m4s`.
 * Segments go through the same `/dash/<id>/sabr/<track>/<file>` proxy the DASH
 * path uses, so the browser never sees a companion URL. Safari plays this
 * natively (H.264 + AAC in fMP4); hls.js handles everything else.
 *
 * Tradeoff, same as the DASH side: the ladder is H.264 capped at the
 * companion's `SABR_MAX_HEIGHT` (1080p), and only the default audio track.
 */
import { fetchCompanionSabrVodManifest } from "@/server/services/dash/sabr-vod";
import {
  type InvidiousCaption,
  subtitleRenditions,
} from "@/server/services/hls/generate";

export type SabrTimeline = {
  timescale: number;
  startNumber: number;
  /** Segment durations in `timescale` units, in order. */
  durations: number[];
};

export type SabrVideoRep = {
  id: string;
  codecs: string;
  width: number;
  height: number;
  bandwidth: number;
};

export type SabrAudioTrack = {
  id: string;
  codecs: string;
  bandwidth: number;
  lang?: string;
  label?: string;
  timeline: SabrTimeline;
};

export type SabrVod = {
  video: { timeline: SabrTimeline; reps: SabrVideoRep[] };
  audio: SabrAudioTrack[];
};

/** Track names the connector uses (`v720`, `a-default`) and our route accepts. */
export const SABR_TRACK_RE = /^[\w.-]{1,64}$/;

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

function parseTimeline(set: string): SabrTimeline | null {
  const template = /<SegmentTemplate\b[^>]*>/.exec(set)?.[0];
  if (!template) return null;
  const timescale = Number(attr(template, "timescale"));
  const startNumber = Number(attr(template, "startNumber") ?? 1);
  if (!(timescale > 0) || !Number.isInteger(startNumber)) return null;
  const durations: number[] = [];
  for (const s of set.matchAll(/<S\b[^>]*\/>/g)) {
    const d = Number(attr(s[0], "d"));
    const r = Number(attr(s[0], "r") ?? 0);
    // A negative `r` ("repeat until the next S / period end") is not something
    // the connector emits; refuse rather than guess.
    if (!(d > 0) || !Number.isInteger(r) || r < 0) return null;
    for (let i = 0; i <= r; i++) durations.push(d);
  }
  if (durations.length === 0) return null;
  return { timescale, startNumber, durations };
}

/**
 * Pure parser for the connector's static VOD manifest (exported for tests).
 * Null unless it has a video ladder and at least one audio track, each with a
 * usable timeline; caption sets are ignored (we advertise our own).
 */
export function parseSabrVodManifest(mpd: string): SabrVod | null {
  let video: SabrVod["video"] | null = null;
  const audio: SabrAudioTrack[] = [];
  for (const m of mpd.matchAll(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/g)) {
    const set = m[0];
    const head = /<AdaptationSet\b[^>]*>/.exec(set)?.[0] ?? "";
    const mime = attr(head, "mimeType") ?? "";
    if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue;
    const timeline = parseTimeline(set);
    if (!timeline) continue;
    const reps = [...set.matchAll(/<Representation\b[^>]*>/g)].map((r) => r[0]);
    if (mime.startsWith("video/")) {
      if (video) continue; // the connector emits one ladder; keep the first
      const parsed = reps.flatMap((r): SabrVideoRep[] => {
        const id = attr(r, "id");
        if (!id || !SABR_TRACK_RE.test(id)) return [];
        return [
          {
            id,
            codecs: attr(r, "codecs") ?? "",
            width: Number(attr(r, "width")) || 0,
            height: Number(attr(r, "height")) || 0,
            bandwidth: Number(attr(r, "bandwidth")) || 0,
          },
        ];
      });
      if (parsed.length > 0) video = { timeline, reps: parsed };
    } else {
      const r = reps[0];
      const id = r ? attr(r, "id") : undefined;
      if (!r || !id || !SABR_TRACK_RE.test(id)) continue;
      const lang = attr(head, "lang");
      const label = /<Label>([^<]*)<\/Label>/.exec(set)?.[1]?.trim();
      audio.push({
        id,
        codecs: attr(r, "codecs") ?? "",
        bandwidth: Number(attr(r, "bandwidth")) || 0,
        // The connector says "default" when YouTube names no language.
        lang: lang && lang !== "default" ? lang : undefined,
        label: label && label !== "default" ? label : undefined,
        timeline,
      });
    }
  }
  if (!video || audio.length === 0) return null;
  return { video, audio };
}

/** Quoted-string attribute values may not contain `"` or line breaks. */
function quoted(value: string): string {
  return value.replace(/["\r\n]/g, "");
}

function mediaPlaylistUri(track: string): string {
  return `sabr.m3u8?track=${encodeURIComponent(track)}`;
}

/**
 * Pure master-playlist builder (exported for tests): the video ladder
 * (highest first, as the byte-range master orders it) sharing one audio
 * group. The first audio track is the default — the connector lists the
 * original first.
 */
export function buildSabrMasterPlaylist(
  vod: SabrVod,
  captions: InvidiousCaption[] = [],
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const [i, t] of vod.audio.entries()) {
    const name =
      vod.audio.length === 1
        ? "Audio"
        : quoted(t.label ?? t.lang?.toUpperCase() ?? `Audio ${i + 1}`);
    const language = t.lang ? `,LANGUAGE="${quoted(t.lang)}"` : "";
    const flag = i === 0 ? "YES" : "NO";
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${name}"${language},DEFAULT=${flag},AUTOSELECT=${flag},URI="${mediaPlaylistUri(t.id)}"`,
    );
  }
  const subtitles = subtitleRenditions(captions);
  lines.push(...subtitles);
  const subtitlesGroup = subtitles.length > 0 ? `,SUBTITLES="subs"` : "";
  const audio = vod.audio[0] as SabrAudioTrack;
  const reps = [...vod.video.reps].sort((a, b) => b.height - a.height);
  for (const v of reps) {
    const res = v.width && v.height ? `,RESOLUTION=${v.width}x${v.height}` : "";
    const codecs = [v.codecs, audio.codecs].filter(Boolean).join(",");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth + audio.bandwidth}${res},CODECS="${quoted(codecs)}",AUDIO="aud"${subtitlesGroup}`,
    );
    lines.push(mediaPlaylistUri(v.id));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Pure media-playlist builder (exported for tests) for one track, its
 * segments on our `/dash/<id>/sabr/` proxy.
 */
export function buildSabrMediaPlaylist(
  videoId: string,
  track: string,
  timeline: SabrTimeline,
): string {
  const base = `/dash/${encodeURIComponent(videoId)}/sabr/${encodeURIComponent(track)}`;
  const seconds = timeline.durations.map((d) => d / timeline.timescale);
  const target = Math.ceil(seconds.reduce((m, s) => Math.max(m, s), 0));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-MAP:URI="${base}/init.mp4"`,
  ];
  for (const [i, s] of seconds.entries()) {
    lines.push(`#EXTINF:${s.toFixed(6)},`);
    lines.push(`${base}/seg-${timeline.startNumber + i}.m4s`);
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

/**
 * The master and every media playlist of one load come from the same
 * manifest; keep it briefly so they share one companion round-trip. The
 * connector keeps its sessions for hours, and its segment route re-prepares
 * a session it lost (see `serveSabrVodSegment`), so a cached manifest stays
 * playable.
 */
const SABR_MANIFEST_TTL_MS = 10 * 60_000;
const sabrCache = new Map<
  string,
  { at: number; vod: Promise<SabrVod | null> }
>();

export function fetchSabrVod(videoId: string): Promise<SabrVod | null> {
  const now = Date.now();
  for (const [k, v] of sabrCache) {
    if (now - v.at >= SABR_MANIFEST_TTL_MS) sabrCache.delete(k);
  }
  const hit = sabrCache.get(videoId);
  if (hit) return hit.vod;
  const vod = fetchCompanionSabrVodManifest(videoId)
    .then((mpd) => (mpd ? parseSabrVodManifest(mpd) : null))
    .then((parsed) => {
      // Don't remember a miss: the next request should ask again.
      if (!parsed) sabrCache.delete(videoId);
      return parsed;
    })
    .catch(() => {
      sabrCache.delete(videoId);
      return null;
    });
  sabrCache.set(videoId, { at: now, vod });
  return vod;
}

/** Master playlist from the connector, or null when it has nothing usable. */
export async function generateSabrMasterPlaylist(
  videoId: string,
  captions: () => Promise<InvidiousCaption[]>,
): Promise<string | null> {
  const vod = await fetchSabrVod(videoId);
  if (!vod) return null;
  return buildSabrMasterPlaylist(vod, await captions().catch(() => []));
}

/** One track's media playlist, or null when the connector or track is gone. */
export async function generateSabrMediaPlaylist(
  videoId: string,
  track: string,
): Promise<string | null> {
  const vod = await fetchSabrVod(videoId);
  if (!vod) return null;
  if (vod.video.reps.some((r) => r.id === track)) {
    return buildSabrMediaPlaylist(videoId, track, vod.video.timeline);
  }
  const audio = vod.audio.find((a) => a.id === track);
  return audio ? buildSabrMediaPlaylist(videoId, track, audio.timeline) : null;
}
