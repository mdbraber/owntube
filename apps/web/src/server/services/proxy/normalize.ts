import { parseRelativePublishedToUnix } from "@/lib/published-sort-key";
import { preferHighResVideoThumbnailUrl } from "@/lib/video-thumbnail-url";
import type { VideoStoryboard } from "@/server/services/proxy.types";

/** Cache rows store the real upstream name (`piped` / `invidious`), never `"cache"`. */
export function liveUpstreamSource(
  label: "piped" | "invidious" | "cache",
): "piped" | "invidious" {
  if (label === "cache") {
    throw new Error("proxy: write path received cache source label");
  }
  return label;
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Invidious often returns paths like `/api/v1/manifest/...` — resolve against the instance base. */
export function resolveInvidiousAbsoluteMediaUrl(
  pathOrUrl: string | undefined,
  baseUrl: string,
): string | undefined {
  if (typeof pathOrUrl !== "string") return undefined;
  const t = pathOrUrl.trim();
  if (!t) return undefined;
  if (t.startsWith("http://") || t.startsWith("https://")) {
    try {
      // Keep valid absolute URLs as-is.
      return new URL(t).toString();
    } catch {
      // Some Invidious builds emit malformed host-less absolute URLs:
      // `http://:3210/path`. Recover by reusing base hostname/protocol.
      const broken = t.match(/^https?:\/\/:(\d+)(\/.*)?$/i);
      if (broken) {
        try {
          const base = new URL(baseUrl);
          const u = new URL(base.toString());
          u.port = broken[1] ?? "";
          const rawTail = broken[2] ?? "/";
          const qIdx = rawTail.indexOf("?");
          if (qIdx >= 0) {
            u.pathname = rawTail.slice(0, qIdx) || "/";
            u.search = rawTail.slice(qIdx);
          } else {
            u.pathname = rawTail;
            u.search = "";
          }
          return u.toString();
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }
  if (t.startsWith("//")) return `https:${t}`;
  const base = normalizeBaseUrl(baseUrl);
  if (t.startsWith("/")) return `${base}${t}`;
  return undefined;
}

/**
 * Docker often publishes `127.0.0.1:port` only; Node may resolve `localhost` to `::1` and fail.
 * Use IPv4 loopback for outbound fetches and for absolute URLs sent to the browser in dev.
 */
export function normalizeInvidiousOutboundBase(base: string): string {
  try {
    const u = new URL(base);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return normalizeBaseUrl(u.toString());
  } catch {
    return normalizeBaseUrl(base);
  }
}

export function extractVideoIdFromUrl(url: string): string | undefined {
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  const m2 = url.match(
    /(?:youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m2) return m2[1];
  return undefined;
}

export function channelIdFromPath(
  uploaderUrl: string | undefined,
): string | undefined {
  if (!uploaderUrl) return undefined;
  const m = uploaderUrl.match(/\/channel\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  return undefined;
}

/** Piped / Invidious sometimes send counts as strings, alternate keys, or localized numbers. */
export function parseViewCountValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const t = value.replace(/\u202f|\s/g, "").trim();
    if (!t) return undefined;
    const compact = /^([\d,.]+)\s*([kKmMbB])?$/;
    const m = compact.exec(t);
    if (m) {
      const base = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(base) || base < 0) return undefined;
      const suf = (m[2] ?? "").toLowerCase();
      const mult =
        suf === "k" ? 1e3 : suf === "m" ? 1e6 : suf === "b" ? 1e9 : 1;
      return Math.floor(base * mult);
    }
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  return undefined;
}

export function pickViewCount(o: Record<string, unknown>): number | undefined {
  const keys = ["views", "viewCount", "view_count"] as const;
  let zeroish: number | undefined;
  for (const k of keys) {
    const n = parseViewCountValue(o[k]);
    if (n !== undefined && n > 0) return n;
    if (n === 0 && zeroish === undefined) zeroish = 0;
  }
  return zeroish;
}

export function reconcilePublishedAtWithText(
  publishedAt: number | undefined,
  publishedText: string | undefined,
): number | undefined {
  if (!publishedText?.trim()) return publishedAt;
  const now = Math.floor(Date.now() / 1000);
  const fromText = parseRelativePublishedToUnix(publishedText, now);
  if (fromText === undefined) return publishedAt;
  if (publishedAt === undefined) return fromText;
  // Some instances return a mismatched numeric timestamp (often "too recent").
  // If delta is large, trust relative text for consistency in feed ordering/labels.
  if (Math.abs(publishedAt - fromText) > 2 * 3600) return fromText;
  return publishedAt;
}

export function upstreamBadgesOrLabelsRestricted(
  o: Record<string, unknown>,
): boolean {
  const lists = [o.badges, o.videoBadges, o.ownerBadges];
  for (const raw of lists) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (typeof item === "string") {
        if (/member|membre|subscriber\s+only|subs?\s+only/i.test(item)) {
          return true;
        }
      } else if (item && typeof item === "object") {
        const r = item as Record<string, unknown>;
        for (const c of [
          r.label,
          r.text,
          r.type,
          r.tooltip,
          r.style,
          r.title,
        ]) {
          if (
            typeof c === "string" &&
            /member|membre|subscriber\s+only|subs?\s+only/i.test(c)
          ) {
            return true;
          }
        }
      }
    }
  }
  const err = o.error;
  if (typeof err === "string" && err.trim().length > 0) {
    if (/\b(members?\s+only|subscriber|private)\b/i.test(err)) return true;
  }
  return false;
}

/**
 * Invidious/Piped list payloads may mark items that need channel membership,
 * payment, or Premium — exclude them from feeds and unified lists.
 */
export function isUpstreamMembersOrPaidOnly(
  o: Record<string, unknown>,
): boolean {
  const on = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
  if (on(o.premium)) return true;
  if (on(o.paid)) return true;
  if (upstreamBadgesOrLabelsRestricted(o)) return true;
  for (const key of [
    "isMembersOnly",
    "membersOnly",
    "is_members_only",
    "members_only",
    "uploaderMember",
    "subscribersOnly",
    "requiresSubscription",
  ] as const) {
    if (on(o[key])) return true;
  }
  return false;
}

export function pickVideoThumbnail(
  thumbnails: unknown,
  videoId?: string,
  opts?: { preferPortrait?: boolean },
): string | undefined {
  if (!Array.isArray(thumbnails)) return undefined;
  const portraitPreferred = ["oar2", "oardefault", "oar1", "oar3"];
  const preferred = [
    "maxresdefault",
    "maxres",
    "hq720",
    "hqdefault",
    "sddefault",
    "mqdefault",
    "default",
  ];
  const byQuality = new Map<string, string>();
  let bestByWidth: { w: number; url: string } | undefined;
  let bestPortrait: { score: number; url: string } | undefined;
  for (const item of thumbnails) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url.startsWith("http")) continue;
    const q = typeof row.quality === "string" ? row.quality.toLowerCase() : "";
    if (q) byQuality.set(q, url);
    const wRaw = row.width;
    const hRaw = row.height;
    const w =
      typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
    const h =
      typeof hRaw === "number" && Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 0;
    if (w > 0 && (!bestByWidth || w > bestByWidth.w)) {
      bestByWidth = { w, url };
    }
    if (opts?.preferPortrait && h > w && h > 0) {
      const score = h * w;
      if (!bestPortrait || score > bestPortrait.score) {
        bestPortrait = { score, url };
      }
    }
  }
  if (opts?.preferPortrait) {
    for (const q of portraitPreferred) {
      const hit = byQuality.get(q);
      if (hit) return preferHighResVideoThumbnailUrl(hit, videoId);
    }
    if (bestPortrait) return bestPortrait.url;
  }
  if (bestByWidth && bestByWidth.w >= 480) {
    return preferHighResVideoThumbnailUrl(bestByWidth.url, videoId);
  }
  for (const q of preferred) {
    const hit = byQuality.get(q);
    if (hit) return preferHighResVideoThumbnailUrl(hit, videoId);
  }
  for (const item of thumbnails) {
    if (!item || typeof item !== "object") continue;
    const maybe = (item as { url?: unknown }).url;
    if (typeof maybe === "string" && maybe.startsWith("http")) {
      return preferHighResVideoThumbnailUrl(maybe, videoId);
    }
  }
  return undefined;
}

export function resolveInvidiousThumbnail(
  thumbs: unknown,
  baseUrl: string,
  opts?: { preferPortrait?: boolean },
): string | undefined {
  if (!Array.isArray(thumbs)) return undefined;
  const portraitPreferred = ["oar2", "oardefault", "oar1", "oar3"];
  const preferred = [
    "maxresdefault",
    "sddefault",
    "high",
    "medium",
    "default",
    "low",
    "maxres",
    "hq720",
    "hqdefault",
    "mqdefault",
  ];
  const candidates = new Map<string, string>();
  let bestByWidth: { w: number; url: string } | undefined;
  let bestPortrait: { score: number; url: string } | undefined;
  const base = normalizeBaseUrl(baseUrl);
  for (const thumb of thumbs) {
    if (!thumb || typeof thumb !== "object") continue;
    const t = thumb as Record<string, unknown>;
    const u = typeof t.url === "string" ? t.url : "";
    const q = typeof t.quality === "string" ? t.quality.toLowerCase() : "";
    const wRaw = t.width;
    const hRaw = t.height;
    const w =
      typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
    const h =
      typeof hRaw === "number" && Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 0;
    if (!u) continue;
    const resolved = resolveInvidiousAbsoluteMediaUrl(u, base);
    if (!resolved?.startsWith("http")) continue;
    if (q) candidates.set(q, resolved);
    if (w > 0 && (!bestByWidth || w > bestByWidth.w)) {
      bestByWidth = { w, url: resolved };
    }
    if (opts?.preferPortrait && h > w && h > 0) {
      const score = h * w;
      if (!bestPortrait || score > bestPortrait.score) {
        bestPortrait = { score, url: resolved };
      }
    }
  }
  if (opts?.preferPortrait) {
    for (const q of portraitPreferred) {
      const hit = candidates.get(q);
      if (hit) return hit;
    }
    if (bestPortrait) return bestPortrait.url;
  }
  if (bestByWidth && bestByWidth.w >= 48) return bestByWidth.url;
  for (const q of preferred) {
    if (candidates.has(q)) return candidates.get(q);
  }
  return bestByWidth?.url ?? candidates.values().next().value;
}

export function pickInvidiousStoryboard(
  o: Record<string, unknown>,
  baseUrl: string,
): VideoStoryboard | undefined {
  const boards = o.storyboards;
  if (!Array.isArray(boards) || boards.length === 0) return undefined;
  let best: VideoStoryboard | undefined;
  let bestScore = -1;
  for (const item of boards) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const templateRaw =
      typeof b.templateUrl === "string" ? b.templateUrl : undefined;
    const templateUrl = templateRaw
      ? resolveInvidiousAbsoluteMediaUrl(templateRaw, baseUrl)
      : undefined;
    if (!templateUrl) continue;
    const thumbWidth =
      typeof b.width === "number" && b.width > 0 ? Math.floor(b.width) : 0;
    const thumbHeight =
      typeof b.height === "number" && b.height > 0 ? Math.floor(b.height) : 0;
    const count =
      typeof b.count === "number" && b.count > 0 ? Math.floor(b.count) : 0;
    let intervalMs =
      typeof b.interval === "number" && b.interval > 0
        ? Math.floor(b.interval)
        : 0;
    if (intervalMs > 0 && intervalMs < 100) intervalMs *= 1000;
    const columns =
      typeof b.storyboardWidth === "number" && b.storyboardWidth > 0
        ? Math.floor(b.storyboardWidth)
        : 1;
    const rows =
      typeof b.storyboardHeight === "number" && b.storyboardHeight > 0
        ? Math.floor(b.storyboardHeight)
        : 1;
    const storyboardCount =
      typeof b.storyboardCount === "number" && b.storyboardCount > 0
        ? Math.floor(b.storyboardCount)
        : 1;
    if (thumbWidth <= 0 || thumbHeight <= 0 || count <= 0 || intervalMs <= 0) {
      continue;
    }
    const candidate: VideoStoryboard = {
      templateUrl,
      thumbWidth,
      thumbHeight,
      count,
      intervalMs,
      columns,
      rows,
      storyboardCount,
    };
    const score = thumbWidth * thumbHeight;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function readPositiveNumberField(
  o: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

/** Invidious/Piped `height` / Invidious `size` ("1280x720"); includes 0 if API sends it. */
export function readStreamHeightPx(
  stream: Record<string, unknown>,
): number | undefined {
  const h = stream.height;
  if (typeof h === "number" && Number.isFinite(h) && h >= 0)
    return Math.round(h);
  if (typeof h === "string") {
    const n = Number.parseInt(h.trim(), 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const sz = stream.size;
  if (typeof sz === "string") {
    const m = sz.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (m) {
      const px = Number.parseInt(m[2] ?? "", 10);
      if (Number.isFinite(px) && px > 0) return px;
    }
  }
  return undefined;
}

export function mimeVideoTypeWithoutAudioCodecs(
  mime: string | undefined,
): boolean {
  if (!mime?.trim()) return false;
  if (!mime.toLowerCase().startsWith("video/")) return false;
  const m = mime.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!m?.[1]) return false;
  const c = m[1].toLowerCase().replace(/\s/g, "");
  const hasVideo = /avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(c);
  const hasAudio = /mp4a|opus|vorbis|flac|ac-3|ec-3/.test(c);
  return hasVideo && !hasAudio;
}

export function toUnixText(seconds: unknown): string | undefined {
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return `${Math.floor(seconds)}s`;
  }
  return undefined;
}
