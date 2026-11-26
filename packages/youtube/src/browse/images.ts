import type { Image } from "@owntube/contracts/model";

/**
 * YouTube's image hosts and their keys under the gateway's image route
 * (`/media/img/<key>/<path>`). Queries are kept: YouTube signs thumbnail and
 * storyboard URLs too.
 */
export const IMAGE_HOSTS: Readonly<Record<string, string>> = {
  yti: "i.ytimg.com",
  yti9: "i9.ytimg.com",
  yt3: "yt3.ggpht.com",
  yt3gu: "yt3.googleusercontent.com",
};

const KEY_BY_HOST = new Map(
  Object.entries(IMAGE_HOSTS).map(([key, host]) => [host, key]),
);

/** The gateway path for a YouTube image URL, or undefined for any other host. */
export function gatewayImageUrl(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url.startsWith("//") ? `https:${url}` : url);
  } catch {
    return undefined;
  }
  const key = KEY_BY_HOST.get(u.host);
  return key ? `/media/img/${key}${u.pathname}${u.search}` : undefined;
}

export function toImages(
  list:
    | ReadonlyArray<{ url: string; width?: number; height?: number }>
    | undefined,
): Image[] {
  const out: Image[] = [];
  for (const t of list ?? []) {
    const url = gatewayImageUrl(t.url);
    if (!url) continue;
    out.push({
      url,
      ...(t.width ? { width: t.width } : {}),
      ...(t.height ? { height: t.height } : {}),
    });
  }
  return out;
}
