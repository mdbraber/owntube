/**
 * Live and post-live DVR: YouTube's own HLS (from the session's player
 * response), with every URL pointing back into the playback session, because
 * its playlists and segments are bound to the session's address. A rendition
 * is keyed by its itag, which survives YouTube handing out fresh URLs.
 */
export interface LiveState {
  masterUrl: string;
  /** itag → rendition. */
  renditions: Map<string, LiveRendition>;
}

export interface LiveRendition {
  url: string;
  /** Media sequence number → segment URL, for the segments listed so far. */
  segments: Map<number, string>;
  initUrl?: string;
  /** The last upstream playlist, shared by clients polling within `PLAYLIST_TTL_MS`. */
  cached?: { at: number; text: Promise<string> };
}

/** Live playlists are re-read upstream at most this often, whatever clients do. */
export const PLAYLIST_TTL_MS = 2_000;
/** Segment URLs kept per rendition: a DVR window is ~1000; this leaves room for a long seek-back. */
const MAX_SEGMENTS = 4_000;

export function itagOf(url: string): string | null {
  return /\/itag\/(\d+)\//.exec(url)?.[1] ?? null;
}

/** The master playlist with each rendition URL pointing at `/l/<itag>.m3u8` in the session. */
export function rewriteMaster(
  text: string,
  state: LiveState,
  base: string,
): string {
  const register = (url: string): string => {
    const itag = itagOf(url);
    if (!itag) throw new Error("live master: rendition without itag");
    const existing = state.renditions.get(itag);
    if (existing) existing.url = url;
    else state.renditions.set(itag, { url, segments: new Map() });
    return `${base}/l/${itag}.m3u8`;
  };
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("https://")) return register(line.trim());
      return line.replace(
        /URI="(https:\/\/[^"]+)"/g,
        (_, url: string) => `URI="${register(url)}"`,
      );
    })
    .join("\n");
}

/** A media playlist with each segment pointing at `/l/<itag>/<sequence>` in the session. */
export function rewriteMedia(
  text: string,
  itag: string,
  rendition: LiveRendition,
  base: string,
): string {
  let sequence = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1] ?? 0);
  const out = text.split("\n").map((line) => {
    if (line.startsWith("#EXT-X-MAP:")) {
      return line.replace(/URI="(https:\/\/[^"]+)"/, (_, url: string) => {
        rendition.initUrl = url;
        return `URI="${base}/l/${itag}/init"`;
      });
    }
    if (!line.startsWith("https://")) return line;
    rendition.segments.set(sequence, line.trim());
    return `${base}/l/${itag}/${sequence++}`;
  });
  for (const key of rendition.segments.keys()) {
    if (rendition.segments.size <= MAX_SEGMENTS) break;
    rendition.segments.delete(key);
  }
  return out.join("\n");
}
