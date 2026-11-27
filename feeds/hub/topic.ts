/**
 * Topic URLs, as this hub sees them.
 *
 * OwnTube's feeds live at per-user secret addresses
 * (https://host/rss/<token>/<kind>/<slug>.<variant>.xml), so the URL alone
 * identifies a user's feed and the hub fetches it as is. Matching normalises
 * the encodings clients are known to vary. URLs with credentials are refused.
 */

function decodeOr(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHttp(topic: string): URL | null {
  let url: URL;
  try {
    url = new URL(topic);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.username || url.password ? null : url;
}

/** The key subscriptions and announcements are matched on, or null for a
 * topic this hub can't serve. */
export function topicKey(topic: string): string | null {
  const url = parseHttp(topic);
  if (!url) return null;
  const path = url.pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeOr(segment)))
    .join("/");
  return `${url.host}${path}${url.search}`;
}

export function topicHostname(topic: string): string | null {
  return parseHttp(topic)?.hostname ?? null;
}

/** Safe-to-log form of a topic: a secret-address token shows only its start. */
export function redact(topic: string): string {
  return topic.replace(
    /(:\/\/[^/]*\/rss\/)([0-9a-f]{32})(?=\/|$)/,
    (_, prefix: string, token: string) => `${prefix}${token.slice(0, 6)}…`,
  );
}
