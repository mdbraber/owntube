export function formatViews(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return null;
  if (n >= 1_000_000) return `${Math.floor(n / 1_000_000)}M views`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K views`;
  return `${n} views`;
}

export function formatSubscribersLabel(
  count: number | undefined,
): string | null {
  const compact = formatCompactCount(count);
  if (!compact) return null;
  const n = Math.floor(count ?? 0);
  return `${compact} subscriber${n === 1 ? "" : "s"}`;
}

export function formatCompactCount(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n) || n < 0) return null;
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v >= 10
      ? `${Math.floor(v)}M`
      : `${v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v >= 10
      ? `${Math.floor(v)}K`
      : `${v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(Math.floor(n));
}

export function formatDuration(sec: number | undefined) {
  if (sec === undefined || !Number.isFinite(sec)) return null;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type ThumbnailBadgeInput = {
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
};

/** Duration pill on cards: LIVE / Upcoming / formatted length. */
export function formatThumbnailBadge({
  durationSeconds,
  isLive,
  isUpcoming,
}: ThumbnailBadgeInput): string | null {
  if (isUpcoming) return "Upcoming";
  if (isLive) return "Live";
  return formatDuration(durationSeconds);
}

function formatRelativeFromNow(secondsSinceEpoch: number): string | null {
  if (!Number.isFinite(secondsSinceEpoch) || secondsSinceEpoch <= 0)
    return null;
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - Math.floor(secondsSinceEpoch));

  if (delta < 60) return "just now";
  if (delta < 3600) {
    const n = Math.floor(delta / 60);
    return `${n} minute${n > 1 ? "s" : ""} ago`;
  }
  if (delta < 86_400) {
    const n = Math.floor(delta / 3600);
    return `${n} hour${n > 1 ? "s" : ""} ago`;
  }
  if (delta < 2_592_000) {
    const n = Math.floor(delta / 86_400);
    return `${n} day${n > 1 ? "s" : ""} ago`;
  }
  if (delta < 31_536_000) {
    const n = Math.floor(delta / 2_592_000);
    return `${n} month${n > 1 ? "s" : ""} ago`;
  }
  const n = Math.floor(delta / 31_536_000);
  return `${n} year${n > 1 ? "s" : ""} ago`;
}

export function formatPublishedAbsoluteLabel(
  publishedAt: number | undefined,
): string | null {
  if (typeof publishedAt !== "number" || !Number.isFinite(publishedAt)) {
    return null;
  }
  const d = new Date(Math.floor(publishedAt) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export function formatPublishedDebugTitle(
  publishedText: string | undefined,
  publishedAt: number | undefined,
): string | null {
  const absolute = formatPublishedAbsoluteLabel(publishedAt);
  const text = publishedText?.trim();
  if (absolute && text) return `${absolute} (${text})`;
  if (absolute) return absolute;
  if (text) return text;
  return null;
}

/** Upstream relative date string (e.g. Invidious / Piped `publishedText`). */
export function formatPublishedLabel(
  publishedText: string | undefined,
  publishedAt?: number,
): string | null {
  if (typeof publishedAt === "number" && Number.isFinite(publishedAt)) {
    const fromTimestamp = formatRelativeFromNow(publishedAt);
    if (fromTimestamp) return fromTimestamp;
  }
  if (!publishedText) return null;
  const t = publishedText.trim();
  if (!t) return null;
  const sec = /^(\d{9,13})s$/i.exec(t);
  if (sec) {
    let s = Number.parseInt(sec[1], 10);
    if (s > 1_000_000_000_000) s = Math.floor(s / 1000);
    const fromUnixText = formatRelativeFromNow(s);
    if (fromUnixText) return fromUnixText;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) {
      const fromIso = formatRelativeFromNow(Math.floor(ms / 1000));
      if (fromIso) return fromIso;
    }
  }
  return t.length > 56 ? `${t.slice(0, 55)}…` : t;
}
