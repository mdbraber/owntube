/**
 * Browser-reachable OwnTube origin for same-origin media proxies.
 * On Docker/Unraid the `Host` header is often `0.0.0.0:3000` or an internal
 * name — set `APP_BASE_URL` to the URL you use in the browser.
 */
export function appOriginFromEnv(): string | null {
  const raw =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.AUTH_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function hostLooksUnreachable(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "0.0.0.0" || h === "[::]";
}

export function resolveAppOriginFromHeaders(
  h?: { get(name: string): string | null },
  fallback = "http://localhost:3000",
): string {
  const fromEnv = appOriginFromEnv();
  if (fromEnv) return fromEnv;

  if (!h) return fallback;

  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host")?.trim() ||
    "";
  if (!host) return fallback;

  try {
    if (hostLooksUnreachable(new URL(`http://${host}`).hostname)) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const p =
    proto === "https" || proto === "http"
      ? proto
      : h.get("x-forwarded-ssl") === "on"
        ? "https"
        : "http";
  return `${p}://${host}`;
}
