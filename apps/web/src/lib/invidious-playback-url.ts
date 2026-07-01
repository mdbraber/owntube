/**
 * Stream URLs in our cache are often built with 127.0.0.1/localhost (see
 * `normalizeInvidiousOutboundBase` for server fetches). The **browser** must
 * use a hostname that reaches Invidious from the user’s device — e.g. when
 * the app is opened as http://192.168.1.14:3000, media must go to
 * http://192.168.1.14:3001, not 127.0.0.1:3001 (which would target the
 * client machine, not the server).
 */
export function hostnameFromRequestHostHeader(hostHeader: string): string {
  const first = hostHeader.split(",")[0]?.trim() ?? hostHeader;
  if (first.startsWith("[")) {
    const j = first.indexOf("]");
    if (j > 0) return first.slice(1, j);
  }
  const c = first.lastIndexOf(":");
  if (c > 0) {
    const possiblePort = first.slice(c + 1);
    if (/^\d{1,5}$/.test(possiblePort)) {
      return first.slice(0, c) ?? first;
    }
  }
  return first;
}

export function rewriteStreamUrlForRequestHost(
  url: string,
  requestHost: string,
): string {
  if (!url || !requestHost) return url;
  try {
    const media = new URL(url);
    if (media.hostname !== "127.0.0.1" && media.hostname !== "localhost") {
      return url;
    }
    const h = hostnameFromRequestHostHeader(requestHost);
    if (!h) return url;
    media.hostname = h;
    return media.toString();
  } catch {
    return url;
  }
}

export function maybeRewritePosterForRequest(
  poster: string | undefined,
  requestHost: string,
): string | undefined {
  if (!poster) return undefined;
  return rewriteStreamUrlForRequestHost(poster, requestHost);
}
