import {
  FetchLoader,
  type HlsConfig,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
  XhrLoader,
} from "hls.js";
import {
  isYoutubeFamilyHostname,
  toInvidiousProxyUrl,
  toYouTubeHopProxyUrl,
} from "@/lib/invidious-proxy";

function invidiousMediaPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/") ||
    pathname.startsWith("/api/manifest/") ||
    pathname.startsWith("/vi/") ||
    pathname.startsWith("/videoplayback")
  );
}

function isAlreadyProxied(url: URL, appOrigin: string): boolean {
  try {
    const app = new URL(appOrigin);
    if (url.origin !== app.origin) return false;
    return url.pathname === "/yt-hls" || url.pathname.startsWith("/invidious/");
  } catch {
    return false;
  }
}

function isYoutubeVideoplaybackPath(pathname: string): boolean {
  return (
    pathname.startsWith("/videoplayback/") ||
    pathname.startsWith("/initplayback/")
  );
}

/** Last googlevideo host seen in a manifest hop (for mis-resolved relative segments). */
let lastYoutubeManifestHost: string | null = null;

function rememberYoutubeManifestHost(rawUrl: string): void {
  try {
    const u = new URL(rawUrl);
    if (u.pathname === "/yt-hls") {
      const inner = u.searchParams.get("url");
      if (inner) rememberYoutubeManifestHost(inner);
      return;
    }
    if (isYoutubeFamilyHostname(u.hostname)) {
      lastYoutubeManifestHost = u.hostname;
    }
  } catch {
    /* ignore */
  }
}

function reconstructMisresolvedVideoplaybackUrl(
  pathUrl: URL,
  appOrigin: string,
): string {
  const host = lastYoutubeManifestHost ?? "manifest.googlevideo.com";
  const absolute = `https://${host}${pathUrl.pathname}${pathUrl.search}${pathUrl.hash}`;
  return toYouTubeHopProxyUrl(absolute, appOrigin);
}

function isMisresolvedYoutubeOnAppOrigin(url: URL, appOrigin: string): boolean {
  try {
    const app = new URL(appOrigin);
    return (
      url.origin === app.origin && isYoutubeVideoplaybackPath(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Rewrites an HLS manifest or segment URL to a same-origin hop when the browser
 * cannot fetch it cross-origin (YouTube/googlevideo, Invidious).
 */
export function proxyUrlForHlsFetch(
  rawUrl: string,
  appOrigin: string = getClientAppOrigin(),
): string {
  if (!rawUrl?.trim()) return rawUrl;
  rememberYoutubeManifestHost(rawUrl);
  try {
    const resolved = new URL(rawUrl, appOrigin);
    if (isAlreadyProxied(resolved, appOrigin)) {
      return resolved.toString();
    }
    if (isMisresolvedYoutubeOnAppOrigin(resolved, appOrigin)) {
      return reconstructMisresolvedVideoplaybackUrl(resolved, appOrigin);
    }
    if (isYoutubeFamilyHostname(resolved.hostname)) {
      return toYouTubeHopProxyUrl(resolved.toString(), appOrigin);
    }
    if (invidiousMediaPath(resolved.pathname)) {
      return toInvidiousProxyUrl(resolved.toString(), appOrigin);
    }
    return resolved.toString();
  } catch {
    return rawUrl;
  }
}

/** Clears cached manifest host (for tests). */
export function resetHlsSameOriginManifestHostCache(): void {
  lastYoutubeManifestHost = null;
}

export function getClientAppOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

function withProxiedContext(
  context: LoaderContext,
  appOrigin: string,
): LoaderContext {
  const proxied = proxyUrlForHlsFetch(context.url, appOrigin);
  return proxied === context.url ? context : { ...context, url: proxied };
}

function createProxiedLoaderClass(
  Base: typeof FetchLoader | typeof XhrLoader,
  appOrigin: string,
): typeof FetchLoader {
  return class SameOriginLoader extends (Base as typeof FetchLoader) {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      super.load(withProxiedContext(context, appOrigin), config, callbacks);
    }
  };
}

/** hls.js config: proxy googlevideo / Invidious segment and playlist fetches. */
export function buildHlsSameOriginConfig(
  appOrigin: string = getClientAppOrigin(),
): Partial<HlsConfig> {
  const rewrite = (url: string) => proxyUrlForHlsFetch(url, appOrigin);
  const BaseLoader = typeof fetch === "function" ? FetchLoader : XhrLoader;
  const ProxiedLoader = createProxiedLoaderClass(BaseLoader, appOrigin);

  return {
    loader: ProxiedLoader,
    startFragPrefetch: true,
    // Deeper buffer absorbs proxied-segment latency: fewer mid-playback stalls
    // and snappier seeks. Live keeps its own low-latency config elsewhere.
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferHole: 0.5,
    xhrSetup(xhr, url) {
      const proxied = rewrite(url);
      if (proxied !== url) {
        xhr.open("GET", proxied, true);
      }
    },
    fetchSetup(context, initParams) {
      const proxied = rewrite(context.url);
      if (proxied !== context.url) {
        return new Request(proxied, initParams);
      }
      return new Request(context.url, initParams);
    },
  };
}

type VidstackHlsProvider = {
  type?: string;
  config?: Partial<HlsConfig>;
  library?: (() => Promise<typeof import("hls.js").default>) | string;
};

/** Apply same-origin hls.js config on a Vidstack HLS provider (if present). */
export function applyHlsSameOriginToVidstackProvider(
  provider: VidstackHlsProvider | null | undefined,
): void {
  if (provider?.type !== "hls") return;
  provider.config = buildHlsSameOriginConfig();
  provider.library = () => import("hls.js").then((m) => m.default);
}

let fetchGuardInstallCount = 0;
let restoreFetchGuard: (() => void) | null = null;

function resolveFetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

/**
 * Rewrites any stray googlevideo / YouTube CDN fetch (fetch + XHR) to our
 * same-origin hops. Ref-counted for multiple concurrent players.
 */
export function installSameOriginMediaFetchGuard(
  appOrigin: string = getClientAppOrigin(),
): () => void {
  if (typeof window === "undefined") return () => {};

  fetchGuardInstallCount += 1;
  if (fetchGuardInstallCount > 1) {
    return () => {
      fetchGuardInstallCount -= 1;
      if (fetchGuardInstallCount === 0 && restoreFetchGuard) {
        restoreFetchGuard();
        restoreFetchGuard = null;
      }
    };
  }

  const nativeFetch = window.fetch.bind(window);
  const nativeXhrOpen = XMLHttpRequest.prototype.open;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = resolveFetchInputUrl(input);
    const proxied = proxyUrlForHlsFetch(raw, appOrigin);
    if (proxied === raw) return nativeFetch(input, init);
    if (typeof input === "string") return nativeFetch(proxied, init);
    if (input instanceof Request) {
      return nativeFetch(new Request(proxied, input), init);
    }
    return nativeFetch(proxied, init);
  };

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    user?: string | null,
    password?: string | null,
  ) {
    const raw = typeof url === "string" ? url : url.toString();
    const proxied = proxyUrlForHlsFetch(raw, appOrigin);
    const next = proxied !== raw ? proxied : url;
    return nativeXhrOpen.call(
      this,
      method,
      next,
      async ?? true,
      user,
      password,
    );
  };

  restoreFetchGuard = () => {
    window.fetch = nativeFetch;
    XMLHttpRequest.prototype.open = nativeXhrOpen;
  };

  return () => {
    fetchGuardInstallCount -= 1;
    if (fetchGuardInstallCount === 0 && restoreFetchGuard) {
      restoreFetchGuard();
      restoreFetchGuard = null;
    }
  };
}
