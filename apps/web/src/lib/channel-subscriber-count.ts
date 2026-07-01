/** Parse human-readable subscriber counts (Invidious `subCountText`, etc.). */
export function parseSubscriberCountText(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, "");
  if (!t || t.includes("hidden")) return null;
  const m = /^([\d.]+)\s*([kmb])?/.exec(t);
  if (!m?.[1]) return null;
  const base = Number.parseFloat(m[1]);
  if (!Number.isFinite(base) || base < 0) return null;
  const unit = m[2];
  if (unit === "k") return Math.round(base * 1_000);
  if (unit === "m") return Math.round(base * 1_000_000);
  if (unit === "b") return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

export function pickChannelSubscriberCount(
  o: Record<string, unknown>,
): number | undefined {
  const numericKeys = [
    "subscriberCount",
    "uploaderSubscriberCount",
    "uploaderSubCount",
    "subCount",
    "authorSubCount",
  ] as const;
  for (const key of numericKeys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.floor(v);
    }
  }
  const textKeys = ["subCountText", "uploaderSubCountText"] as const;
  for (const key of textKeys) {
    const raw = o[key];
    if (typeof raw === "string") {
      const parsed = parseSubscriberCountText(raw);
      if (parsed !== null && parsed > 0) return parsed;
    }
  }
  return undefined;
}
