import type { Count } from "@owntube/contracts/model";

/**
 * Numbers YouTube gives only as text, read from its English wording (the
 * gateway always asks for `hl=en`): "1,841,079,665 views" is exact, "1.6M
 * views", "122K" and "4.56M subscribers" are approximate, "No views" is 0.
 */
export function parseCount(text: string | undefined): Count | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (/^no\b/i.test(t)) return { value: 0, approximate: false };
  const m = /^([\d.,]+)\s*([KMB])?\b/i.exec(t);
  if (!m) return undefined;
  const digits = (m[1] as string).replace(/,/g, "");
  const unit = m[2]?.toUpperCase();
  if (!unit)
    return Number.isFinite(Number(digits))
      ? { value: Number(digits), approximate: false }
      : undefined;
  const scale = unit === "K" ? 1e3 : unit === "M" ? 1e6 : 1e9;
  return { value: Math.round(Number(digits) * scale), approximate: true };
}

/** "15:16" or "1:02:03" → seconds. */
export function parseClock(text: string | undefined): number | undefined {
  if (!text || !/^\d+(:\d{1,2}){1,2}$/.test(text.trim())) return undefined;
  return text
    .trim()
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

/** "15:16" (a duration), as opposed to "LIVE", "SHORTS" or "UPCOMING" badges. */
export function isClock(text: string | undefined): boolean {
  return parseClock(text) !== undefined;
}
