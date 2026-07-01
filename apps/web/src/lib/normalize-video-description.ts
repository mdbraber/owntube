const BR_RE = /<br\s*\/?>/gi;
const BLOCKED_BLOCK_END_RE = /<\/(?:p|div|li|motion\.p)>/gi;
const ANCHOR_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const TAG_RE = /<[^>]+>/g;
const CHAPTER_LABEL_RE = /^\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:\s*[-–—]\s*|\s+).+$/;
const TIMESTAMP_ONLY_LABEL_RE = /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/;

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseYoutubeTimeParam(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  let total = 0;
  let matched = false;
  for (const m of value.matchAll(/(\d+)\s*([hms])/gi)) {
    const n = Number.parseInt(m[1] ?? "", 10);
    const unit = (m[2] ?? "").toLowerCase();
    if (!Number.isFinite(n)) continue;
    matched = true;
    if (unit === "h") total += n * 3600;
    else if (unit === "m") total += n * 60;
    else if (unit === "s") total += n;
  }
  return matched ? total : null;
}

/** Seconds → `m:ss` or `h:mm:ss` for chapter lines. */
export function formatChapterTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Read `t` / `start` from YouTube / Piped chapter deep links. */
export function extractTimestampSecondsFromUrl(href: string): number | null {
  try {
    const u = new URL(href, "https://www.youtube.com");
    for (const key of ["t", "start"]) {
      const raw = u.searchParams.get(key);
      if (!raw) continue;
      const parsed = parseYoutubeTimeParam(raw);
      if (parsed !== null) return parsed;
    }
    const hash = u.hash.replace(/^#/, "");
    const hashMatch = /(?:^|[?&])t=([^&]+)/i.exec(hash);
    if (hashMatch?.[1]) {
      const parsed = parseYoutubeTimeParam(hashMatch[1]);
      if (parsed !== null) return parsed;
    }
  } catch {
    const loose = /[?&#](?:t|start)=([^&\s#]+)/i.exec(href);
    if (loose?.[1]) {
      const parsed = parseYoutubeTimeParam(decodeURIComponent(loose[1]));
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function anchorReplacement(href: string, label: string): string {
  const url = href.trim();
  const inner = decodeHtmlEntities(label.replace(TAG_RE, " ").trim());
  if (inner && CHAPTER_LABEL_RE.test(inner)) return inner;
  if (inner && TIMESTAMP_ONLY_LABEL_RE.test(inner)) return inner;
  const fromUrl = url ? extractTimestampSecondsFromUrl(url) : null;
  if (fromUrl !== null) {
    const stamp = formatChapterTimestamp(fromUrl);
    if (inner && !/^https?:\/\//i.test(inner)) {
      return `${stamp} ${inner}`;
    }
    return stamp;
  }
  if (url) return url;
  return inner;
}

export function looksLikeHtmlDescription(text: string): boolean {
  return /<(?:br|a|p|div|span|b|i|ul|li)\b/i.test(text);
}

/** Convert Piped / YouTube HTML descriptions to plain text for display. */
export function normalizePipedDescription(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  text = text.replace(BR_RE, "\n").replace(BLOCKED_BLOCK_END_RE, "\n");
  text = text.replace(ANCHOR_RE, (_match, href: string, label: string) =>
    anchorReplacement(href, label),
  );
  text = decodeHtmlEntities(text.replace(TAG_RE, ""));
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
