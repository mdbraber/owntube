/**
 * Server-side VOD DASH (MPD) generation from YouTube/Invidious adaptive
 * streams — the >1080p path.
 *
 * The synthesized HLS manifest (see `../hls/generate.ts`) is AVC-only because
 * hls.js cannot demux WebM, and neither Invidious's nor companion's own DASH
 * generator exposes the VP9/AV1 rungs — so every existing manifest tops out
 * at 1080p. The raw `adaptiveFormats` DO carry the full VP9 ladder (and AV1
 * when YouTube encoded it) with init/index byte ranges, which is everything a
 * DASH `SegmentBase` representation needs: unlike HLS we don't even parse the
 * `sidx` — the player does.
 *
 * One video AdaptationSet per manifest, codec family chosen by the client via
 * `?video=` (probed with `MediaSource.isTypeSupported`), so ABR always climbs
 * a single consistent ladder. Audio is the default AAC track. Segments ride
 * the same same-origin `/invidious/videoplayback` proxy as the HLS path.
 */

import {
  type AdaptiveFormat,
  codecsOf,
  fetchAdaptiveFormats,
  segmentUri,
} from "@/server/services/hls/generate";

export type DashVideoFamily = "vp9" | "av01" | "avc";

export const DASH_VIDEO_FAMILIES: readonly DashVideoFamily[] = [
  "vp9",
  "av01",
  "avc",
];

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function familyOf(type: string): DashVideoFamily | null {
  if (/avc1/i.test(type)) return "avc";
  if (/av01/i.test(type)) return "av01";
  if (/vp0?9/i.test(type)) return "vp9";
  return null;
}

/** Stream URLs embed `dur=<seconds>`; cheaper than a second detail fetch. */
function durationSecondsFromFormats(af: AdaptiveFormat[]): number {
  for (const f of af) {
    const m = /[?&]dur=([\d.]+)/.exec(f.url ?? "");
    if (m?.[1]) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 0;
}

/** The API repeats rows (per host); keep the first of each itag. */
function dedupeByItag(af: AdaptiveFormat[]): AdaptiveFormat[] {
  const seen = new Set<string>();
  const out: AdaptiveFormat[] = [];
  for (const f of af) {
    const key = String(f.itag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function usable(f: AdaptiveFormat): boolean {
  return Boolean(f.url && f.init && f.index);
}

export function pickDashVideoFormats(
  af: AdaptiveFormat[],
  family: DashVideoFamily,
): AdaptiveFormat[] {
  return dedupeByItag(af)
    .filter(
      (f) =>
        f.type.startsWith("video/") && usable(f) && familyOf(f.type) === family,
    )
    .sort((a, b) => Number(b.bitrate) - Number(a.bitrate));
}

function pickDashAudioFormat(af: AdaptiveFormat[]): AdaptiveFormat | undefined {
  // Default AAC track: decodable everywhere, matches the HLS path.
  return dedupeByItag(af).find((f) => /mp4a/.test(f.type) && usable(f));
}

function representationXml(f: AdaptiveFormat, indent: string): string {
  const [w, h] = (f.size ?? "").split("x").map((n) => Number.parseInt(n, 10));
  const dims =
    Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      ? ` width="${w}" height="${h}"`
      : "";
  const fps =
    typeof f.fps === "number" && f.fps > 0 ? ` frameRate="${f.fps}"` : "";
  const bandwidth = Math.max(1, Number(f.bitrate) || 1);
  return [
    `${indent}<Representation id="${xmlEscape(String(f.itag))}" codecs="${xmlEscape(codecsOf(f.type))}" bandwidth="${bandwidth}"${dims}${fps}>`,
    `${indent}  <BaseURL>${xmlEscape(segmentUri(f.url))}</BaseURL>`,
    `${indent}  <SegmentBase indexRange="${xmlEscape(f.index)}">`,
    `${indent}    <Initialization range="${xmlEscape(f.init)}"/>`,
    `${indent}  </SegmentBase>`,
    `${indent}</Representation>`,
  ].join("\n");
}

/** Pure MPD builder (exported for tests). */
export function buildMpd(
  videos: AdaptiveFormat[],
  audio: AdaptiveFormat,
  durationSeconds: number,
): string {
  const videoMime = videos[0]?.type.split(";")[0]?.trim() ?? "video/mp4";
  const dur = durationSeconds > 0 ? durationSeconds.toFixed(3) : "0";
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011,urn:webm:dash:profile:webm-on-demand:2012" type="static" mediaPresentationDuration="PT${dur}S" minBufferTime="PT2S">`,
    `  <Period>`,
    `    <AdaptationSet id="0" mimeType="${xmlEscape(videoMime)}" startWithSAP="1" subsegmentAlignment="true" scanType="progressive">`,
    ...videos.map((f) => representationXml(f, "      ")),
    `    </AdaptationSet>`,
    `    <AdaptationSet id="1" mimeType="${xmlEscape(audio.type.split(";")[0]?.trim() ?? "audio/mp4")}" startWithSAP="1" subsegmentAlignment="true">`,
    representationXml(audio, "      "),
    `    </AdaptationSet>`,
    `  </Period>`,
    `</MPD>`,
  ];
  return `${lines.join("\n")}\n`;
}

/** MPD for one video, video codec family chosen by the client's MSE probe. */
export async function generateMpd(
  videoId: string,
  family: DashVideoFamily,
): Promise<string> {
  const af = await fetchAdaptiveFormats(videoId);
  let videos = pickDashVideoFormats(af, family);
  if (videos.length === 0 && family !== "avc") {
    // Family not offered for this video (e.g. no AV1 upstream) — serve AVC so
    // playback still works; the ladder just stays ≤1080p.
    videos = pickDashVideoFormats(af, "avc");
  }
  const audio = pickDashAudioFormat(af);
  if (videos.length === 0 || !audio) {
    throw new Error("no usable adaptive video + AAC audio streams");
  }
  return buildMpd(videos, audio, durationSecondsFromFormats(af));
}
