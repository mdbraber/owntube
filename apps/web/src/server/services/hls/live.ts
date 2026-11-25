/**
 * Live broadcasts as HLS, for players that play only HLS: AVPlayer on Apple TV
 * (and the iPhone app), which can't take the live DASH manifest at all.
 *
 * Built from the same manifest `/dash/<id>/live.mpd` serves (see
 * dash/live-manifest.ts), so nothing new is fetched from YouTube: its
 * representations are AVC video and AAC audio in fMP4, five-second segments
 * numbered by a SegmentTemplate, and each one is already served at
 * `/dash/<id>/live/<rep>/sq/<n>/lmt/<m>`, with its init segment at
 * `/dash/<id>/live/<rep>/init`. HLS lists the same URLs, asking for each
 * segment without its repeated init boxes (`?hls=1`):
 *
 *   /hls/<id>/live.m3u8               -> the video ladder plus the audio track
 *   /hls/<id>/live-media.m3u8?rep=<n> -> a sliding window of one representation
 */
import { buildLiveManifest } from "@/server/services/dash/live-manifest";

/** Segments a media playlist lists: a short window behind the live edge. */
export const LIVE_WINDOW_SEGMENTS = 24;

/** The variant players start on: the one closest to this height, at or below. */
const START_HEIGHT = 720;

export type LiveRepresentation = {
  kind: "audio" | "video";
  /** The representation's index in its `/dash/<id>/live/<rep>/` path. */
  rep: string;
  codecs: string;
  bandwidth: number;
  width?: number;
  height?: number;
  frameRate?: number;
  /** `/dash/<id>/live/<rep>/`, which segment and init paths resolve against. */
  baseUrl: string;
  media: string;
  initialization: string;
  /** Every segment the manifest lists, oldest first. */
  segments: { number: number; seconds: number }[];
};

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

function numberAttr(tag: string, name: string): number | undefined {
  const value = attr(tag, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** The representations of a live manifest, with their segment numbers. */
export function parseLiveManifest(mpd: string): LiveRepresentation[] {
  const reps: LiveRepresentation[] = [];
  for (const set of mpd.matchAll(
    /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g,
  )) {
    const mimeType = attr(set[1] ?? "", "mimeType") ?? "";
    const kind = mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("video/")
        ? "video"
        : null;
    if (!kind) continue;
    for (const r of (set[2] ?? "").matchAll(
      /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g,
    )) {
      const head = r[1] ?? "";
      const body = r[2] ?? "";
      const baseUrl = /<BaseURL>([^<]*)<\/BaseURL>/.exec(body)?.[1]?.trim();
      const rep = baseUrl ? /\/live\/(\d{1,3})\/$/.exec(baseUrl)?.[1] : null;
      const template = /<SegmentTemplate\b([^>]*)>/.exec(body)?.[1];
      if (!baseUrl || !rep || !template) continue;
      const media = attr(template, "media");
      const initialization = attr(template, "initialization");
      if (!media || !initialization) continue;
      const timescale = numberAttr(template, "timescale") ?? 1;
      let number = numberAttr(template, "startNumber") ?? 1;
      const segments: LiveRepresentation["segments"] = [];
      for (const s of body.matchAll(/<S\b([^>]*)\/>/g)) {
        const d = numberAttr(s[1] ?? "", "d");
        if (!d) continue;
        // r is how many times the segment repeats after the first; -1 (open
        // ended) only ever ends a timeline, and counts as no repeat here.
        const repeats = Math.max(0, numberAttr(s[1] ?? "", "r") ?? 0);
        for (let i = 0; i <= repeats; i += 1) {
          segments.push({ number, seconds: d / timescale });
          number += 1;
        }
      }
      if (segments.length === 0) continue;
      reps.push({
        kind,
        rep,
        codecs: attr(head, "codecs") ?? "",
        bandwidth: numberAttr(head, "bandwidth") ?? 0,
        width: numberAttr(head, "width"),
        height: numberAttr(head, "height"),
        frameRate: numberAttr(head, "frameRate"),
        baseUrl,
        media,
        initialization,
        segments,
      });
    }
  }
  return reps;
}

/** AVC video, the only video every AVPlayer plays. */
function playableVideo(reps: LiveRepresentation[]): LiveRepresentation[] {
  return reps.filter((r) => r.kind === "video" && r.codecs.startsWith("avc1"));
}

/** The AAC track with the most bits: YouTube's 140 over the thin 139. */
function bestAudio(reps: LiveRepresentation[]): LiveRepresentation | undefined {
  return reps
    .filter((r) => r.kind === "audio" && r.codecs.startsWith("mp4a"))
    .sort((a, b) => b.bandwidth - a.bandwidth)[0];
}

/**
 * The master playlist: every AVC rung with the best AAC track as its audio
 * group. The first variant is where AVPlayer starts, so the rung nearest
 * 720p leads and the rest follow from the lowest up.
 */
export function liveMasterPlaylist(reps: LiveRepresentation[]): string | null {
  const audio = bestAudio(reps);
  const videos = playableVideo(reps).sort((a, b) => a.bandwidth - b.bandwidth);
  if (!audio || videos.length === 0) return null;
  const start =
    [...videos].reverse().find((v) => (v.height ?? 0) <= START_HEIGHT) ??
    videos[0];
  const ordered = start
    ? [start, ...videos.filter((v) => v !== start)]
    : videos;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="live-media.m3u8?rep=${audio.rep}"`,
  ];
  for (const v of ordered) {
    const info = [
      `BANDWIDTH=${v.bandwidth + audio.bandwidth}`,
      `CODECS="${v.codecs},${audio.codecs}"`,
    ];
    if (v.width && v.height) info.push(`RESOLUTION=${v.width}x${v.height}`);
    if (v.frameRate) info.push(`FRAME-RATE=${v.frameRate.toFixed(3)}`);
    info.push('AUDIO="audio"');
    lines.push(`#EXT-X-STREAM-INF:${info.join(",")}`);
    lines.push(`live-media.m3u8?rep=${v.rep}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A segment at the live DASH route, asking for its media alone (`?hls`): YouTube's
 * live segments repeat their init boxes, which HLS players don't accept.
 */
function segmentPath(rep: LiveRepresentation, number: number): string {
  return `${rep.baseUrl}${rep.media.replaceAll("$Number$", String(number))}?hls=1`;
}

/**
 * One representation as a live media playlist: the newest
 * `LIVE_WINDOW_SEGMENTS` segments and no end tag, so players reload it like
 * any live HLS. Segment numbers carry over as media sequence numbers.
 */
export function liveMediaPlaylist(rep: LiveRepresentation): string {
  const window = rep.segments.slice(-LIVE_WINDOW_SEGMENTS);
  const first = window[0];
  const target = Math.ceil(Math.max(...window.map((s) => s.seconds)));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${target}`,
    `#EXT-X-MEDIA-SEQUENCE:${first?.number ?? 0}`,
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MAP:URI="${rep.baseUrl}${rep.initialization}"`,
  ];
  for (const segment of window) {
    lines.push(`#EXTINF:${segment.seconds.toFixed(3)},`);
    lines.push(segmentPath(rep, segment.number));
  }
  return `${lines.join("\n")}\n`;
}

/** The live master playlist for a broadcast, or null when it has none. */
export async function generateLiveMasterPlaylist(
  videoId: string,
): Promise<string | null> {
  const mpd = await buildLiveManifest(videoId);
  return mpd ? liveMasterPlaylist(parseLiveManifest(mpd)) : null;
}

/** One representation's live media playlist, or null when it isn't there. */
export async function generateLiveMediaPlaylist(
  videoId: string,
  rep: string,
): Promise<string | null> {
  const mpd = await buildLiveManifest(videoId);
  if (!mpd) return null;
  const found = parseLiveManifest(mpd).find((r) => r.rep === rep);
  return found ? liveMediaPlaylist(found) : null;
}
