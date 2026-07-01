export type RichTextPart =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string; label?: string }
  | { kind: "time"; value: string; seconds: number };

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const TIME_RE = /\b(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/g;
const ANCHOR_RE =
  /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function parseTimeToSeconds(raw: string): number | null {
  const bits = raw.split(":");
  if (bits.length === 2) {
    const m = Number.parseInt(bits[0] ?? "", 10);
    const s = Number.parseInt(bits[1] ?? "", 10);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    if (m < 0 || s < 0 || s >= 60) return null;
    return m * 60 + s;
  }
  if (bits.length === 3) {
    const h = Number.parseInt(bits[0] ?? "", 10);
    const m = Number.parseInt(bits[1] ?? "", 10);
    const s = Number.parseInt(bits[2] ?? "", 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
      return null;
    }
    if (h < 0 || m < 0 || m >= 60 || s < 0 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

export function youtubeTimestampFromUrl(url: string): number | null {
  const normalized = decodeHtmlEntities(url.trim());
  if (!normalized) return null;
  try {
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, "");
    const isYoutube =
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "m.youtube.com" ||
      host.endsWith(".youtube.com");
    if (!isYoutube) return null;

    const tParam = u.searchParams.get("t") ?? u.searchParams.get("start");
    if (tParam) {
      const fromParam = parseYoutubeTimeParam(tParam);
      if (fromParam != null) return fromParam;
    }

    if (u.hash.startsWith("#t=")) {
      const fromHash = parseYoutubeTimeParam(u.hash.slice(3));
      if (fromHash != null) return fromHash;
    }
  } catch {
    const m = normalized.match(/[?&]t=([^&]+)/i);
    if (m?.[1]) {
      const fromParam = parseYoutubeTimeParam(m[1]);
      if (fromParam != null) return fromParam;
    }
  }
  return null;
}

function parseYoutubeTimeParam(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  let seconds = 0;
  const h = t.match(/(\d+)h/i);
  const m = t.match(/(\d+)m/i);
  const s = t.match(/(\d+)s/i);
  if (h) seconds += Number.parseInt(h[1] ?? "0", 10) * 3600;
  if (m) seconds += Number.parseInt(m[1] ?? "0", 10) * 60;
  if (s) seconds += Number.parseInt(s[1] ?? "0", 10);
  if (h || m || s) return seconds;
  return parseTimeToSeconds(t);
}

function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ""));
}

function splitTimestamps(text: string): RichTextPart[] {
  const out: RichTextPart[] = [];
  let last = 0;
  TIME_RE.lastIndex = 0;
  for (const m of text.matchAll(TIME_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    const raw = m[0] ?? "";
    const seconds = parseTimeToSeconds(raw);
    if (seconds == null) out.push({ kind: "text", value: raw });
    else out.push({ kind: "time", value: raw, seconds });
    last = idx + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

function splitPlainSegment(segment: string): RichTextPart[] {
  const plain = stripHtmlTags(segment);
  if (!plain) return [];
  const out: RichTextPart[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  for (const m of plain.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    const url = m[0] ?? "";
    if (idx > last) out.push(...splitTimestamps(plain.slice(last, idx)));
    const seconds = youtubeTimestampFromUrl(url);
    if (seconds != null) {
      out.push({ kind: "time", value: url, seconds });
    } else {
      out.push({ kind: "url", value: url });
    }
    last = idx + url.length;
  }
  if (last < plain.length) out.push(...splitTimestamps(plain.slice(last)));
  return out;
}

function parseHtmlRichText(raw: string): RichTextPart[] {
  const parts: RichTextPart[] = [];
  let last = 0;
  ANCHOR_RE.lastIndex = 0;
  for (const m of raw.matchAll(ANCHOR_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(...splitPlainSegment(raw.slice(last, idx)));
    const href = decodeHtmlEntities(m[1] ?? "");
    const label = stripHtmlTags(m[2] ?? "").trim();
    const seconds = youtubeTimestampFromUrl(href);
    if (seconds != null) {
      parts.push({
        kind: "time",
        value: label || formatSecondsClock(seconds),
        seconds,
      });
    } else if (href) {
      parts.push({ kind: "url", value: href, label: label || undefined });
    }
    last = idx + (m[0]?.length ?? 0);
  }
  if (last < raw.length) parts.push(...splitPlainSegment(raw.slice(last)));
  return parts;
}

function formatSecondsClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Parse plain text, URLs, timestamps, and Invidious-style HTML anchors. */
export function parseRichText(raw: string): RichTextPart[] {
  if (!raw.trim()) return [];
  if (/<a\s/i.test(raw)) return parseHtmlRichText(raw);
  return splitPlainSegment(raw);
}

/** Merge adjacent text parts for simpler rendering. */
export function compactRichTextParts(parts: RichTextPart[]): RichTextPart[] {
  const out: RichTextPart[] = [];
  for (const part of parts) {
    if (part.kind === "text" && !part.value) continue;
    const prev = out.at(-1);
    if (part.kind === "text" && prev?.kind === "text") {
      prev.value += part.value;
      continue;
    }
    out.push({ ...part });
  }
  return out;
}
