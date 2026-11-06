/**
 * YouTube URL normalisation — the one place that knows what YouTube URLs look
 * like in the wild and maps each shape to OwnTube's canonical URL:
 *   video    -> /watch?v=<id>[&t=<seconds>]
 *   playlist -> /playlist?list=<id>
 *   channel  -> /channel/<id | @handle | name>
 *
 * Used by `middleware.ts` (308 redirects) and the watch page (reading `?v=` and
 * `?t=`), so the two cannot drift apart. Pure: no Next.js imports, so it runs in
 * the edge middleware, on the server and in the browser (search box).
 *
 * Canonical forms are built from an allow-list of parameters, so YouTube's
 * tracking parameters (`si`, `is`, `pp`, `feature`, `ab_channel`, `app`,
 * `embeds_referring_*`, …) never survive a redirect.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** An id followed by nothing, or by a stray `?`/`&`/`#`/`/` and more params. */
const VIDEO_ID_WITH_TAIL_RE = /^([A-Za-z0-9_-]{11})(?:[?&#/]([\s\S]*))?$/;

/** Single-video path prefixes: `/<prefix>/<id>` -> `/watch?v=<id>`. */
const VIDEO_PREFIXES = new Set(["shorts", "embed", "live", "v", "e"]);

/** YouTube `/feed/<name>` pages and their OwnTube equivalents. */
const FEED_TARGETS: Record<string, string> = {
  subscriptions: "/subscriptions",
  channels: "/subscriptions/channels",
  trending: "/trending",
  explore: "/trending",
  history: "/history",
  library: "/playlists",
  playlists: "/playlists",
  you: "/playlists",
};

/**
 * YouTube-only pages with no OwnTube equivalent; they go to the home page
 * rather than a 404. (`account*` is matched as a prefix.)
 */
const YOUTUBE_ONLY_PATHS = new Set([
  "about",
  "ads",
  "creators",
  "gaming",
  "howyoutubeworks",
  "kids",
  "logout",
  "new",
  "originals",
  "paid_memberships",
  "playables",
  "podcasts",
  "premium",
  "redirect",
  "reporthistory",
  "signin",
  "signup",
  "t",
  "upload",
  "verify_age",
  "yt",
  "ytkids",
]);

/**
 * OwnTube's own top-level routes. A bare `/<11 chars>` path is a youtu.be link
 * (`youtu.be/<id>` with the host swapped), but `recommended` is 11 characters
 * too, so these names are never read as video ids. `youtube-url.test.ts` checks
 * that every folder in `src/app` is listed here.
 */
const APP_ROUTES = new Set([
  "api",
  "captions",
  "channel",
  "channel-avatar",
  "dash",
  "dashboard",
  "dvr",
  "enclosure",
  "history",
  "hls",
  "image",
  "invidious",
  "login",
  "onboarding",
  "playlist",
  "playlists",
  "queue",
  "recommended",
  "register",
  "saved",
  "search",
  "settings",
  "shorts",
  "stream",
  "subscriptions",
  "trending",
  "tv",
  "watch",
  "yt-hls",
]);

/** Next's RSC cache-busting parameter; never part of a canonical comparison. */
const RSC_PARAM = "_rsc";

/** How deep `/attribution_link?u=` may nest before we give up. */
const MAX_DEPTH = 3;

export type ParsedVideoId = {
  videoId: string;
  /** Parameters that followed a stray `?`, `&`, `#` or `/` after the id. */
  extra: URLSearchParams;
};

/**
 * Read a video id from a `v=` value or a path segment: the first 11 characters
 * of `[A-Za-z0-9_-]`, optionally followed by a stray `?`, `&`, `#` or `/` and
 * further parameters (`dQw4w9WgXcQ?si=abc`). Anything else is not an id.
 */
export function parseVideoIdParam(
  raw: string | null | undefined,
): ParsedVideoId | null {
  const value = raw?.trim() ?? "";
  const match = VIDEO_ID_WITH_TAIL_RE.exec(value);
  if (!match?.[1]) return null;
  return { videoId: match[1], extra: new URLSearchParams(match[2] ?? "") };
}

/** True when `id` is exactly one YouTube video id. */
export function isVideoId(id: string): boolean {
  return VIDEO_ID_RE.test(id);
}

/**
 * A YouTube start time in whole seconds: `90`, `90s`, `1m30s`, `1h2m3s`, `5m`,
 * and the fragment forms `#t=90` / `t=1m30s`. Undefined when unreadable.
 */
export function parseStartSeconds(
  raw: string | null | undefined,
): number | undefined {
  const value = (raw ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^(?:t|start)=/, "")
    .toLowerCase();
  if (!value) return undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(value);
  if (!match) return undefined;
  const [, h, m, s] = match;
  if (h === undefined && m === undefined && s === undefined) return undefined;
  const seconds =
    Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Math.floor(Number(s ?? 0));
  return Number.isFinite(seconds) ? seconds : undefined;
}

export type WatchParams = {
  /** Null when `v` is missing or not a valid id. */
  videoId: string | null;
  startSeconds?: number;
  list?: string;
};

/**
 * Read a watch URL's parameters, repairing a malformed `v`
 * (`v=<id>?si=…`, `v=<id>&t=90` encoded into `v`, …). `vOverride` supplies the
 * id from a path segment instead (`/watch/<id>`, `/shorts/<id>`, …).
 */
export function readWatchParams(
  params: URLSearchParams,
  vOverride?: string,
): WatchParams {
  const parsed = parseVideoIdParam(vOverride ?? params.get("v"));
  // Parameters smuggled in after the id count too, but the real ones win.
  const merged = new URLSearchParams(parsed?.extra);
  for (const [key, value] of params) {
    if (key !== "v") merged.set(key, value);
  }
  const startSeconds = parseStartSeconds(
    merged.get("t") ?? merged.get("start"),
  );
  const list = merged.get("list")?.trim() || undefined;
  return { videoId: parsed?.videoId ?? null, startSeconds, list };
}

function watchPath(videoId: string, startSeconds?: number): string {
  const out = new URLSearchParams({ v: videoId });
  if (startSeconds !== undefined) out.set("t", String(startSeconds));
  return `/watch?${out.toString()}`;
}

function withQuery(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Split a same-origin relative path (`/watch?v=…#t=90`) into its parts; null
 * for anything that could leave the site (`//host`, `/\host`, absolute URLs).
 */
function splitRelativePath(
  value: string,
): { pathname: string; params: URLSearchParams } | null {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  const hashAt = value.indexOf("#");
  const beforeHash = hashAt < 0 ? value : value.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : value.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const pathname = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(
    queryAt < 0 ? "" : beforeHash.slice(queryAt + 1),
  );
  // `#t=90` on a watch link: carry it as a real parameter.
  const hashParams = new URLSearchParams(hash);
  for (const key of ["t", "start"]) {
    const v = hashParams.get(key);
    if (v !== null && !params.has(key)) params.set(key, v);
  }
  return { pathname, params };
}

/**
 * The canonical OwnTube URL for a YouTube-shaped path, or null when the path is
 * not a YouTube shape (OwnTube's own pages, unknown paths). The result may
 * equal the input; `canonicalYoutubePath` decides whether to redirect.
 */
function resolve(
  pathname: string,
  params: URLSearchParams,
  depth: number,
): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  const second = segments[1];
  if (!first) return null;

  // /watch?v=<id> and the former OwnTube /watch/<id>. The watch page has no
  // playlist mode, so `list` / `index` are dropped; a list without a video
  // opens the playlist.
  if (first === "watch") {
    const watch = readWatchParams(params, second);
    if (watch.videoId) return watchPath(watch.videoId, watch.startSeconds);
    if (!params.has("v") && !second && watch.list) {
      return withQuery("/playlist", { list: watch.list });
    }
    // Missing or invalid id: the watch page shows its not-found page.
    return null;
  }

  // /shorts|embed|live|v|e/<id> -> /watch?v=<id>; /embed/videoseries?list=.
  if (VIDEO_PREFIXES.has(first) && second) {
    if (second === "videoseries") {
      const list = params.get("list")?.trim();
      return list ? withQuery("/playlist", { list }) : "/";
    }
    const watch = readWatchParams(params, decodeSegment(second));
    return watch.videoId ? watchPath(watch.videoId, watch.startSeconds) : null;
  }

  // /playlist?list=<id> and the former OwnTube /playlist/<id>.
  if (first === "playlist") {
    const list = (second ? decodeSegment(second) : params.get("list"))?.trim();
    return list ? withQuery("/playlist", { list }) : null;
  }

  // /channel/<id>/<tab…> -> /channel/<id> (the channel page has no URL tabs).
  if (first === "channel" && second) {
    return `/channel/${second}`;
  }

  // /@handle[/tab], /c/Name[/tab], /user/Name[/tab] -> /channel/<token>; the
  // channel service resolves the token to a UC id.
  if (first.startsWith("@") && first.length > 1) return `/channel/${first}`;
  if ((first === "c" || first === "user") && second) {
    return `/channel/${second}`;
  }

  // /results?search_query=X (or q=X; `sp` filters are dropped).
  if (first === "results") {
    const q = (params.get("search_query") ?? params.get("q") ?? "").trim();
    return q ? withQuery("/search", { q }) : "/";
  }

  if (first === "feed") {
    return (second && FEED_TARGETS[second]) || "/";
  }

  if (first === "hashtag") {
    const tag = second ? decodeSegment(second).trim() : "";
    return tag ? withQuery("/search", { q: `#${tag}` }) : "/";
  }

  // A clip id is not a video id; resolving it needs YouTube itself.
  if (first === "clip") return "/";

  // /attribution_link?u=<encoded path>: follow the inner link.
  if (first === "attribution_link") {
    const u = params.get("u")?.trim() ?? "";
    // The inner link is a path (`/watch?v=…`) or, rarely, a full YouTube URL.
    const inner =
      depth < MAX_DEPTH
        ? (splitRelativePath(u) ??
          splitRelativePath(appPathFromYoutubeUrl(u) ?? ""))
        : null;
    if (!inner) return "/";
    return resolve(inner.pathname, inner.params, depth + 1) ?? "/";
  }

  if (YOUTUBE_ONLY_PATHS.has(first) || first.startsWith("account")) return "/";

  // youtu.be/<id> with the host swapped: a bare /<id>.
  if (segments.length === 1 && !APP_ROUTES.has(first) && isVideoId(first)) {
    const watch = readWatchParams(params, first);
    return watch.videoId ? watchPath(watch.videoId, watch.startSeconds) : null;
  }

  return null;
}

/**
 * Where a request for `pathname` + `search` should be redirected, as a
 * same-origin path with query (`/watch?v=…`), or null to serve it as is.
 * `search` may be given with or without its leading `?`.
 */
export function canonicalYoutubePath(
  pathname: string,
  search: string,
): string | null {
  const params = new URLSearchParams(search);
  params.delete(RSC_PARAM);
  const target = resolve(pathname, params, 0);
  if (target === null) return null;
  const query = params.toString();
  const current = query ? `${pathname}?${query}` : pathname;
  return target === current ? null : target;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

/**
 * The OwnTube page for a full YouTube URL typed or pasted into the search box
 * (`https://www.youtube.com/watch?v=…`, `youtu.be/…`, `m.youtube.com/…`), or
 * null when the text is not a YouTube URL.
 */
export function appPathFromYoutubeUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  let pathname: string;
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!id) return "/";
    pathname = `/watch/${id}`;
  } else if (YOUTUBE_HOSTS.has(host)) {
    pathname = url.pathname || "/";
  } else {
    return null;
  }

  const relative = splitRelativePath(`${pathname}${url.search}${url.hash}`);
  if (!relative) return "/";
  const resolved = resolve(relative.pathname, relative.params, 0);
  if (resolved) return resolved;
  // Not a known shape (e.g. youtube.com/ itself): the same path on OwnTube.
  const query = relative.params.toString();
  return query ? `${relative.pathname}?${query}` : relative.pathname;
}
