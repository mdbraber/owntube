/**
 * Vidstack needs an accurate MIME type. Our same-origin hop `/yt-hls?url=…`
 * wraps either real HLS entrypoints **or** direct `googlevideo` progressive
 * URLs — they must not all be tagged as HLS or the player parses MP4 bytes
 * as an m3u8 playlist and never starts.
 */
function typeForYtHopInner(
  inner: URL,
): "application/x-mpegurl" | "video/mp4" | "video/webm" {
  const path = inner.pathname.toLowerCase();
  const href = inner.href.toLowerCase();
  const isHlsLike =
    path.includes("/manifest/hls") ||
    path.includes("hls_playlist") ||
    href.includes(".m3u8") ||
    path.endsWith(".m3u8");
  if (isHlsLike) return "application/x-mpegurl";

  const mime = (inner.searchParams.get("mime") ?? "").toLowerCase();
  if (mime.includes("webm")) return "video/webm";
  return "video/mp4";
}

export function sourceFromUrl(url: string): {
  src: string;
  type:
    | "application/x-mpegurl"
    | "application/dash+xml"
    | "video/webm"
    | "video/mp4";
} {
  try {
    const u = new URL(url);
    if (u.pathname === "/yt-hls" && u.searchParams.has("url")) {
      const rawInner = u.searchParams.get("url");
      if (rawInner) {
        try {
          const inner = new URL(rawInner);
          return { src: url, type: typeForYtHopInner(inner) };
        } catch {
          return { src: url, type: "video/mp4" };
        }
      }
      return { src: url, type: "video/mp4" };
    }
  } catch {
    /* relative or invalid — fall through */
  }

  const l = url.toLowerCase();
  if (
    l.includes(".m3u8") ||
    l.includes("/manifest/hls") ||
    l.includes("hls_variant") ||
    l.includes("hls_playlist") ||
    l.includes("playlist.m3u8")
  ) {
    return { src: url, type: "application/x-mpegurl" };
  }
  if (
    l.includes(".mpd") ||
    l.includes("/manifest/dash/") ||
    l.includes("/api/manifest/dash")
  ) {
    return { src: url, type: "application/dash+xml" };
  }
  if (l.includes(".webm") || l.includes("mime%3dvideo%2fwebm")) {
    return { src: url, type: "video/webm" };
  }
  return { src: url, type: "video/mp4" };
}

/** Direct Piped/googlevideo progressive URL — native `<video>` is more reliable than Vidstack. */
export function isDirectProgressiveVideoUrl(src: string): boolean {
  try {
    return new URL(src).pathname === "/videoplayback";
  } catch {
    return src.includes("/videoplayback");
  }
}

export function audioMimeFromMediaUrl(url: string): string | undefined {
  try {
    const mime = new URL(url).searchParams.get("mime")?.toLowerCase();
    if (!mime) return undefined;
    if (mime.startsWith("audio/")) return mime;
    if (mime.startsWith("video/")) return undefined;
    return `audio/${mime}`;
  } catch {
    return undefined;
  }
}
