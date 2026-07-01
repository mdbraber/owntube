import { resolveChannelAvatarUrl } from "@/lib/channel-avatar";
import { normalizeUpstreamBaseUrl } from "@/lib/upstream-base-url";

const MAX_CHANNEL_AVATAR_URL_LEN = 8_192;

/** Public YouTube avatar/thumbnail hosts — safe to load directly in the browser. */
export function isYoutubeAvatarCdn(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h.endsWith(".googleusercontent.com") ||
    h.endsWith(".ggpht.com") ||
    h.endsWith(".ytimg.com")
  );
}

export function isPrivateOrLanHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("10.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/** Origins for configured Invidious instance (browser `/invidious/…` hop). */
export function collectInvidiousOrigins(): string[] {
  const out = new Set<string>();
  const base = normalizeUpstreamBaseUrl(process.env.INVIDIOUS_BASE_URL);
  if (!base) return [];
  try {
    const u = new URL(base);
    out.add(u.origin);
    if (u.hostname === "localhost") {
      const port = u.port ? `:${u.port}` : "";
      out.add(`${u.protocol}//127.0.0.1${port}`);
    }
    if (u.hostname === "127.0.0.1") {
      const port = u.port ? `:${u.port}` : "";
      out.add(`${u.protocol}//localhost${port}`);
    }
  } catch {
    /* ignore malformed env */
  }
  return [...out];
}

/** Origins allowed for `/channel-avatar` upstream fetches (server-side). */
export function collectAllowedChannelAvatarOrigins(): string[] {
  const out = new Set<string>();
  for (const raw of [
    process.env.PIPED_BASE_URL,
    process.env.PIPED_PROXY_BASE_URL,
    process.env.INVIDIOUS_BASE_URL,
  ]) {
    const base = normalizeUpstreamBaseUrl(raw);
    if (!base) continue;
    try {
      const u = new URL(base);
      out.add(u.origin);
      if (u.hostname === "localhost") {
        const port = u.port ? `:${u.port}` : "";
        out.add(`${u.protocol}//127.0.0.1${port}`);
      }
      if (u.hostname === "127.0.0.1") {
        const port = u.port ? `:${u.port}` : "";
        out.add(`${u.protocol}//localhost${port}`);
      }
    } catch {
      /* ignore malformed env */
    }
  }
  return [...out];
}

export function isAllowedChannelAvatarFetchTarget(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (isYoutubeAvatarCdn(url.hostname) && url.protocol === "https:") {
    return true;
  }
  if (collectAllowedChannelAvatarOrigins().includes(url.origin)) {
    return true;
  }
  return false;
}

/**
 * Same-origin `/invidious/…` path only when the URL belongs to the configured
 * Invidious instance (not Piped proxy `/vi/` on another origin).
 */
export function invidiousUpstreamProxyPath(resolvedUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(resolvedUrl);
  } catch {
    return null;
  }
  if (!collectInvidiousOrigins().includes(parsed.origin)) return null;
  const path = parsed.pathname;
  if (
    path.startsWith("/vi/") ||
    path.startsWith("/api/v1/") ||
    path.startsWith("/ggpht/")
  ) {
    return `/invidious${path}${parsed.search}`;
  }
  return null;
}

/** @deprecated Use {@link invidiousUpstreamProxyPath} — kept for tests. */
export function invidiousAvatarProxyPath(resolvedUrl: string): string | null {
  return invidiousUpstreamProxyPath(resolvedUrl);
}

export function shouldProxyChannelAvatarUrl(url: URL): boolean {
  if (url.protocol === "http:") return true;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (isPrivateOrLanHost(host)) return true;
  if (collectAllowedChannelAvatarOrigins().includes(url.origin)) return true;
  return false;
}

const MAX_UPSTREAM_IMAGE_URL_LEN = MAX_CHANNEL_AVATAR_URL_LEN;

function browserReadyUpstreamImageUrl(resolved: string): string | undefined {
  if (resolved.length > MAX_UPSTREAM_IMAGE_URL_LEN) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(resolved);
  } catch {
    return undefined;
  }

  if (isYoutubeAvatarCdn(parsed.hostname) && parsed.protocol === "https:") {
    return resolved;
  }

  const invidiousPath = invidiousUpstreamProxyPath(resolved);
  if (invidiousPath) return invidiousPath;

  if (shouldProxyChannelAvatarUrl(parsed)) {
    return `/channel-avatar?url=${encodeURIComponent(resolved)}`;
  }

  return resolved;
}

/**
 * Browser-ready image URL for upstream media (video thumbnails, etc.): same-origin
 * hops for LAN/HTTP upstreams (mixed content on HTTPS) and Invidious `/vi/`.
 */
export function toBrowserUpstreamImageUrl(
  raw: string | undefined | null,
): string | undefined {
  const resolved = resolveChannelAvatarUrl(raw ?? undefined);
  if (!resolved) return undefined;
  return browserReadyUpstreamImageUrl(resolved);
}

/**
 * Browser-ready avatar URL: same-origin hops for LAN/HTTP upstreams (mixed
 * content on HTTPS reverse proxies) and Invidious `/vi/` paths.
 */
export function toBrowserChannelAvatarUrl(
  raw: string | undefined | null,
): string | undefined {
  const resolved = resolveChannelAvatarUrl(raw ?? undefined);
  if (!resolved) return undefined;
  return browserReadyUpstreamImageUrl(resolved);
}
