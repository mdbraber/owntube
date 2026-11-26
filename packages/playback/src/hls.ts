import type { Segment } from "./sidx.ts";
import { hlsQuoted } from "./text.ts";
import type {
  AudioTrack,
  CaptionTrack,
  Presentation,
  PresentationUrls,
  VideoTrack,
} from "./tracks.ts";

/**
 * HLS over the same byte-range files: a master playlist of video variants
 * with audio and subtitle renditions, and one media playlist per track built
 * from its sidx. Only MP4 tracks are offered (Apple players do not take WebM).
 */
export function buildMasterPlaylist(
  presentation: Presentation,
  urls: PresentationUrls,
): string {
  const video = presentation.video.filter((t) => t.mimeType === "video/mp4");
  const audio = presentation.audio.filter((t) => t.mimeType === "audio/mp4");
  if (video.length === 0 || audio.length === 0)
    throw new Error("no MP4 video or audio tracks");
  const renditions = bestPerLanguage(audio);
  const defaultAudio =
    renditions.find((t) => t.isOriginal) ?? (renditions[0] as AudioTrack);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const track of renditions) {
    // AUTOSELECT only on the original: Apple players let an AUTOSELECT
    // rendition in the system language beat DEFAULT, which started Dutch
    // videos on the English dub for English-language iPhones.
    const flag = track === defaultAudio ? "YES" : "NO";
    const language = track.language
      ? `,LANGUAGE=${hlsQuoted(track.language)}`
      : "";
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME=${hlsQuoted(track.label)}${language},DEFAULT=${flag},AUTOSELECT=${flag},CHANNELS="${track.channels}",URI=${hlsQuoted(urls.mediaPlaylist(track))}`,
    );
  }
  for (const caption of presentation.captions) {
    lines.push(
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME=${hlsQuoted(caption.label)},LANGUAGE=${hlsQuoted(caption.language)},DEFAULT=NO,AUTOSELECT=NO,URI=${hlsQuoted(urls.subtitlePlaylist(caption))}`,
    );
  }
  const subtitles = presentation.captions.length > 0 ? ',SUBTITLES="subs"' : "";
  for (const track of [...video].sort((a, b) => b.bitrate - a.bitrate)) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${track.bitrate + defaultAudio.bitrate},RESOLUTION=${track.width}x${track.height},FRAME-RATE=${track.fps.toFixed(3)},CODECS="${track.codecs},${defaultAudio.codecs}",AUDIO="audio"${subtitles}`,
      urls.mediaPlaylist(track),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** A track's media playlist: its init section and one byte range per sidx segment. */
export function buildMediaPlaylist(
  track: VideoTrack | AudioTrack,
  segments: readonly Segment[],
  urls: PresentationUrls,
): string {
  const uri = hlsQuoted(urls.media(track));
  const target = Math.ceil(Math.max(...segments.map((s) => s.durationSec), 1));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-MAP:URI=${uri},BYTERANGE="${track.init.end - track.init.start + 1}@${track.init.start}"`,
  ];
  for (const s of segments) {
    lines.push(
      `#EXTINF:${s.durationSec.toFixed(6)},`,
      `#EXT-X-BYTERANGE:${s.range.end - s.range.start + 1}@${s.range.start}`,
      urls.media(track),
    );
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

/** A subtitle rendition is one WebVTT file covering the whole video. */
export function buildSubtitlePlaylist(
  caption: CaptionTrack,
  durationSec: number,
  urls: PresentationUrls,
): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${Math.ceil(durationSec)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXTINF:${durationSec.toFixed(3)},`,
    urls.caption(caption),
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}

/** One audio rendition per language: its highest-bitrate MP4 track. */
function bestPerLanguage(audio: readonly AudioTrack[]): AudioTrack[] {
  const best = new Map<string, AudioTrack>();
  for (const t of audio) {
    const key = t.language ?? "und";
    const current = best.get(key);
    if (!current || t.bitrate > current.bitrate) best.set(key, t);
  }
  return [...best.values()].sort(
    (a, b) => Number(b.isOriginal) - Number(a.isOriginal),
  );
}
