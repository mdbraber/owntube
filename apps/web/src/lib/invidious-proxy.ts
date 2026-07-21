import {
  hostnameFromRequestHostHeader,
  rewriteStreamUrlForRequestHost,
} from "@/lib/invidious-playback-url";
import { toMediaOriginUrl } from "@/lib/media-origin";
import type { PlayableVariant } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

function invidiousBaseUrl(): string {
  return process.env.INVIDIOUS_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

export function isInvidiousProxyAvailable(): boolean {
  return invidiousBaseUrl().length > 0;
}

/**
 * hls.js fetches the manifest and segments in the browser. Cross-origin
 * requests to the Invidious port often fail (no CORS). We route everything
 * through OwnTube: `/invidious/...` (same origin). Folder must not start
 * with `_` — Next.js treats `_name` as a private (non-routed) segment.
 */
export function toInvidiousProxyUrl(
  absoluteUrl: string,
  appOrigin: string,
): string {
  const u = new URL(absoluteUrl);
  return new URL(
    `/invidious${u.pathname}${u.search}${u.hash}`,
    appOrigin,
  ).toString();
}

export function getAppOriginFromRequestHeaders(
  h: {
    get(name: string): string | null;
  },
  fallback: string = "http://localhost:3000",
): string {
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host")?.trim() ||
    "";
  if (!host) return fallback;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const p =
    proto === "https" || proto === "http"
      ? proto
      : h.get("x-forwarded-ssl") === "on"
        ? "https"
        : "http";
  return `${p}://${host}`;
}

/**
 * Piped URLs skip this proxy. Invidious media uses several path prefixes;
 * newer HLS lives under `/api/manifest/...` (not only `/api/v1/...`).
 */
export function shouldUseInvidiousProxyForUrl(
  detail: VideoDetail,
  mediaUrl: string,
): boolean {
  if (!isInvidiousProxyAvailable()) return false;
  if (detail.sourceUsed === "piped") return false;
  if (!mediaUrl) return false;
  try {
    const path = new URL(mediaUrl).pathname;
    if (
      path.startsWith("/api/v1/") ||
      path.startsWith("/api/manifest/") ||
      path.startsWith("/vi/") ||
      path.startsWith("/videoplayback")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * m3u8 can list absolute segment URLs. Replace known Invidious base URLs
 * with our `/invidious` same-origin base.
 */
/** Hostnames that must be fetched same-origin (YouTube HLS / segments). */
export function isYoutubeFamilyHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "youtu.be") return true;
  if (h === "youtube.com" || h.endsWith(".youtube.com")) return true;
  if (h === "googlevideo.com" || h.endsWith(".googlevideo.com")) return true;
  return false;
}

function isOwnTubeYtHopUrl(absoluteUrl: string, appOrigin: string): boolean {
  try {
    const u = new URL(absoluteUrl);
    const app = new URL(appOrigin);
    return u.origin === app.origin && u.pathname === "/yt-hls";
  } catch {
    return false;
  }
}

/**
 * Invidious sometimes embeds absolute YouTube / googlevideo URLs in HLS
 * playlists. Browsers cannot read those from our origin (no CORS). Rewrite
 * every such URL to `/yt-hls?url=…` so playback stays same-origin.
 */
export function rewriteYouTubeUrlsInM3u8(
  body: string,
  appOrigin: string,
): string {
  const abs = /https?:\/\/[^\s"'#<>\]]+/g;
  return body.replace(abs, (match) => {
    if (isOwnTubeYtHopUrl(match, appOrigin)) return match;
    try {
      const u = new URL(match);
      if (!isYoutubeFamilyHostname(u.hostname)) return match;
      return toYouTubeHopProxyUrl(match, appOrigin);
    } catch {
      return match;
    }
  });
}

function isOwnTubeInvidiousHopUrl(
  absoluteUrl: string,
  appOrigin: string,
): boolean {
  try {
    const u = new URL(absoluteUrl);
    const app = new URL(appOrigin);
    return u.origin === app.origin && u.pathname.startsWith("/invidious/");
  } catch {
    return false;
  }
}

function resolvePlaylistMediaReference(
  raw: string,
  manifestBase: URL,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    return new URL(trimmed, manifestBase).toString();
  } catch {
    return null;
  }
}

function proxyResolvedPlaylistUrl(
  absoluteUrl: string,
  appOrigin: string,
  invidiousBase: string,
): string {
  if (isOwnTubeYtHopUrl(absoluteUrl, appOrigin)) return absoluteUrl;
  if (isOwnTubeInvidiousHopUrl(absoluteUrl, appOrigin)) return absoluteUrl;

  let parsed: URL;
  try {
    parsed = new URL(absoluteUrl);
  } catch {
    return absoluteUrl;
  }

  if (isYoutubeFamilyHostname(parsed.hostname)) {
    return toYouTubeHopProxyUrl(absoluteUrl, appOrigin);
  }

  const inv = invidiousBase?.trim() ?? "";
  if (inv) {
    try {
      const invOrigin = new URL(inv).origin;
      if (parsed.origin === invOrigin) {
        return toInvidiousProxyUrl(absoluteUrl, appOrigin);
      }
    } catch {
      /* ignore */
    }
  }

  return absoluteUrl;
}

/**
 * Resolve relative HLS media lines and URI="…" tags against the upstream
 * manifest URL, then rewrite to same-origin `/yt-hls` or `/invidious` hops.
 */
export function rewriteHlsPlaylistMediaUrls(
  body: string,
  appOrigin: string,
  manifestUrl: string,
  invidiousBase = "",
): string {
  let manifestBase: URL;
  try {
    manifestBase = new URL(manifestUrl);
  } catch {
    return body;
  }

  const lines = body.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    let next = line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
      const resolved = resolvePlaylistMediaReference(uri, manifestBase);
      if (!resolved) return `URI="${uri}"`;
      return `URI="${proxyResolvedPlaylistUrl(resolved, appOrigin, invidiousBase)}"`;
    });

    const trimmed = next.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const resolved = resolvePlaylistMediaReference(trimmed, manifestBase);
      if (resolved) {
        next = proxyResolvedPlaylistUrl(resolved, appOrigin, invidiousBase);
      }
    }

    out.push(next);
  }

  return out.join("\n");
}

/**
 * Invidious `local=true` can emit `http://:3210/...` when domain is unset in config.
 * Rewrite those to our same-origin `/invidious` hop before hls.js loads child playlists.
 */
function rewriteMalformedInvidiousPortUrls(
  body: string,
  invidiousBase: string,
  proxyRoot: string,
): string {
  let port: string;
  try {
    port = new URL(invidiousBase).port;
  } catch {
    return body;
  }
  if (!port) return body;
  return body
    .split(`http://:${port}/`)
    .join(`${proxyRoot}/`)
    .split(`https://:${port}/`)
    .join(`${proxyRoot}/`);
}

export function rewriteM3u8ForOwnTubeProxy(
  body: string,
  appOrigin: string,
  requestHost: string,
  invidiousBase: string,
): string {
  const base = invidiousBase?.trim() ?? "";
  if (!base) return body;
  const u = new URL(base);
  const proxyRoot = `${appOrigin}/invidious`;
  const out: string[] = [u.origin];
  if (u.port) {
    if (u.protocol === "http:") {
      out.push(`http://127.0.0.1:${u.port}`);
      out.push(`http://localhost:${u.port}`);
      const hn = hostnameFromRequestHostHeader(requestHost);
      if (hn) out.push(`http://${hn}:${u.port}`);
    } else {
      out.push(`https://127.0.0.1:${u.port}`);
      out.push(`https://localhost:${u.port}`);
      const hn = hostnameFromRequestHostHeader(requestHost);
      if (hn) out.push(`https://${hn}:${u.port}`);
    }
  }
  const order = Array.from(new Set(out)).sort((a, b) => b.length - a.length);
  let t = body;
  for (const o of order) {
    t = t.split(o).join(proxyRoot);
  }
  return rewriteMalformedInvidiousPortUrls(t, base, proxyRoot);
}

function isInvidiousLocalVideoplaybackReference(raw: string): boolean {
  return /(?:^|\/)videoplayback\?/i.test(raw.trim());
}

/**
 * Invidious `local=true` lists `/videoplayback?id=…&host=….c.youtube.com&…`.
 * That hop 403s on many instances; rebuild a googlevideo URL for `/yt-hls`.
 */
export function googlevideoUrlFromInvidiousVideoplaybackReference(
  raw: string,
): string | null {
  const trimmed = raw.trim();
  if (!isInvidiousLocalVideoplaybackReference(trimmed)) return null;
  try {
    let parsed: URL;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        parsed = new URL(trimmed);
      } catch {
        const q = trimmed.indexOf("?");
        if (q < 0) return null;
        parsed = new URL(
          `http://local.invalid/videoplayback${trimmed.slice(q)}`,
        );
      }
    } else {
      parsed = new URL(trimmed, "http://local.invalid");
    }
    if (!parsed.pathname.endsWith("/videoplayback")) return null;
    const host =
      parsed.searchParams.get("host") ??
      parsed.searchParams.get("hls_chunk_host");
    if (!host || !isYoutubeFamilyHostname(host)) return null;
    const params = new URLSearchParams(parsed.search);
    params.delete("host");
    params.delete("hls_chunk_host");
    return `https://${host}/videoplayback?${params.toString()}`;
  } catch {
    return null;
  }
}

/** Rewrite Invidious local segment lines to `/yt-hls` googlevideo hops. */
export function rewriteInvidiousVideoplaybackLinesToYtHls(
  body: string,
  appOrigin: string,
): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    let next = line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
      const googlevideo =
        googlevideoUrlFromInvidiousVideoplaybackReference(uri);
      if (!googlevideo) return `URI="${uri}"`;
      return `URI="${toYouTubeHopProxyUrl(googlevideo, appOrigin)}"`;
    });

    const trimmed = next.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const googlevideo =
        googlevideoUrlFromInvidiousVideoplaybackReference(trimmed);
      if (googlevideo) {
        next = toYouTubeHopProxyUrl(googlevideo, appOrigin);
      }
    }

    out.push(next);
  }

  return out.join("\n");
}

/** Invidious base rewrite plus YouTube/googlevideo hop (for hls.js). */
export function rewriteM3u8AllProxies(
  body: string,
  appOrigin: string,
  requestHost: string,
  invidiousBase?: string,
  /** Upstream manifest URL (required to resolve relative segment paths). */
  manifestUrl?: string,
): string {
  const inv = (invidiousBase ?? invidiousBaseUrl()).trim();
  let t = rewriteM3u8ForOwnTubeProxy(body, appOrigin, requestHost, inv);
  if (manifestUrl) {
    t = rewriteHlsPlaylistMediaUrls(t, appOrigin, manifestUrl, inv);
  }
  t = rewriteInvidiousVideoplaybackLinesToYtHls(t, appOrigin);
  t = rewriteYouTubeUrlsInM3u8(t, appOrigin);
  return t;
}

export function toYouTubeHopProxyUrl(
  absoluteUrl: string,
  appOrigin: string,
): string {
  return `${appOrigin}/yt-hls?url=${encodeURIComponent(absoluteUrl)}`;
}

function shouldUseYouTubeHopProxyForUrl(mediaUrl: string): boolean {
  if (!mediaUrl) return false;
  try {
    const u = new URL(mediaUrl);
    if (u.pathname === "/yt-hls") return false;
    return isYoutubeFamilyHostname(u.hostname);
  } catch {
    return false;
  }
}

function isInvidiousHlsManifestUrl(mediaUrl: string): boolean {
  try {
    const path = new URL(mediaUrl).pathname.toLowerCase();
    return path.includes("/api/manifest/hls");
  } catch {
    return mediaUrl.toLowerCase().includes("/api/manifest/hls");
  }
}

/** Ask Invidious to proxy googlevideo segments (`local=true`) instead of raw YouTube URLs. */
export function withInvidiousLocalHlsParam(mediaUrl: string): string {
  if (!isInvidiousHlsManifestUrl(mediaUrl)) return mediaUrl;
  try {
    const u = new URL(mediaUrl);
    if (u.searchParams.get("local") === "true") return mediaUrl;
    u.searchParams.set("local", "true");
    return u.toString();
  } catch {
    return mediaUrl;
  }
}

export function toProxiedOrDirectPlayback(
  rawPlayback: string,
  appOrigin: string,
  requestHost: string,
  detail: VideoDetail,
): string {
  if (!rawPlayback) return rawPlayback;
  const playback = rawPlayback;
  if (shouldUseInvidiousProxyForUrl(detail, playback)) {
    return toInvidiousProxyUrl(playback, appOrigin);
  }
  if (shouldUseYouTubeHopProxyForUrl(rawPlayback)) {
    return toYouTubeHopProxyUrl(rawPlayback, appOrigin);
  }
  // OwnTube's own synthesized `/hls/<id>/master.m3u8` (or any other
  // already-relative path) reaches here unchanged — absolutize it against the
  // media origin so it doesn't implicitly resolve to whatever origin the page
  // happens to be served from.
  const rewritten = requestHost
    ? rewriteStreamUrlForRequestHost(rawPlayback, requestHost)
    : rawPlayback;
  return toMediaOriginUrl(rewritten, appOrigin);
}

export function toProxiedOrDirectPoster(
  rawPoster: string | undefined,
  appOrigin: string,
  requestHost: string,
  detail: VideoDetail,
): string | undefined {
  if (!rawPoster) return undefined;
  if (shouldUseInvidiousProxyForUrl(detail, rawPoster)) {
    return toInvidiousProxyUrl(rawPoster, appOrigin);
  }
  const rewritten = requestHost
    ? rewriteStreamUrlForRequestHost(rawPoster, requestHost)
    : rawPoster;
  return toMediaOriginUrl(rewritten, appOrigin);
}

export type ProxiedPlayableVariant =
  | { t: "muxed"; label: string; src: string }
  | {
      t: "split";
      label: string;
      video: string;
      audio: string;
      audioTracks: { label: string; src: string }[];
      /** Default language row index (original when upstream marks it). */
      defaultAudioIndex?: number;
    };

export function toProxiedOrDirectVariants(
  variants: PlayableVariant[],
  appOrigin: string,
  requestHost: string,
  detail: VideoDetail,
): ProxiedPlayableVariant[] {
  return variants.map((v) => {
    if (v.t === "split") {
      const audioTracks = v.audioOptions.map((o) => ({
        label: o.label,
        src: toProxiedOrDirectPlayback(o.url, appOrigin, requestHost, detail),
      }));
      return {
        t: "split",
        label: v.label,
        video: toProxiedOrDirectPlayback(
          v.videoUrl,
          appOrigin,
          requestHost,
          detail,
        ),
        audio: toProxiedOrDirectPlayback(
          v.audioUrl,
          appOrigin,
          requestHost,
          detail,
        ),
        audioTracks,
        defaultAudioIndex: v.defaultAudioIndex ?? 0,
      };
    }
    return {
      t: "muxed",
      label: v.label,
      src: toProxiedOrDirectPlayback(v.url, appOrigin, requestHost, detail),
    };
  });
}
