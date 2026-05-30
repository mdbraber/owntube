import { BRAND_COLOR } from "@/lib/brand";

const PALETTE = [
  BRAND_COLOR,
  "linear-gradient(135deg, #5533ff, #a855f7)",
  "linear-gradient(135deg, #22c55e, #3355ff)",
  "linear-gradient(135deg, #eab308, #ff6633)",
  "linear-gradient(135deg, #0ea5e9, #8b5cf6)",
] as const;

export function gradientForChannelId(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % PALETTE.length;
  }
  return PALETTE[h] ?? PALETTE[0];
}

export function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const w = parts[0] ?? "";
    return w.slice(0, 2).toUpperCase();
  }
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return `${a}${b}`.toUpperCase();
}

/**
 * Upstream instances occasionally return malformed or protocol-relative avatar URLs.
 * Normalize to a usable browser URL when possible.
 */
export function resolveChannelAvatarUrl(imageUrl?: string): string | undefined {
  if (!imageUrl) return undefined;
  const raw = imageUrl.trim();
  if (!raw) return undefined;
  if (raw.startsWith("data:image/")) return raw;
  if (raw.startsWith("//")) {
    if (typeof window === "undefined") return `https:${raw}`;
    return `${window.location.protocol}${raw}`;
  }
  if (raw.startsWith("/")) return raw;
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    return undefined;
  }
  try {
    return new URL(raw).toString();
  } catch {
    // Repair forms like "http://:3210/path" by reusing current hostname.
    const broken = raw.match(/^https?:\/\/:(\d+)(\/.*)?$/i);
    if (!broken) return undefined;
    const protocol =
      raw.toLowerCase().startsWith("https://") || typeof window === "undefined"
        ? "https:"
        : window.location.protocol;
    const port = broken[1] ?? "";
    const path = broken[2] ?? "/";
    const host =
      typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
    return `${protocol}//${host}:${port}${path}`;
  }
}
