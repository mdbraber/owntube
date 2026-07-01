/** Port the Next.js process listens on (`next dev` / `next start`). */
export function nextAppListenPort(): number {
  const p = Number.parseInt(process.env.PORT ?? "3000", 10);
  return Number.isFinite(p) ? p : 3000;
}

/**
 * True when Invidious is configured on the same loopback port as this Next app.
 * Then server-side `fetch(INVIDIOUS...)` hits OwnTube (HTML/404), not Invidious.
 */
export function invidiousPortCollidesWithNextApp(
  invidiousBaseUrl: string,
): boolean {
  try {
    const u = new URL(invidiousBaseUrl.replace(/\/+$/, ""));
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      return false;
    }
    const invPort =
      u.port === ""
        ? u.protocol === "https:"
          ? 443
          : 80
        : Number.parseInt(u.port, 10);
    if (!Number.isFinite(invPort)) return false;
    return invPort === nextAppListenPort();
  } catch {
    return false;
  }
}
