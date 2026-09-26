/**
 * Topic URLs, as this hub sees them.
 *
 * OwnTube's feeds are per user but share paths — every user has
 * /rss/queue/queue.audio.xml — so a feed's topic URL carries the user's
 * credentials (https://user:pass@host/rss/...). That makes each topic unique
 * per user and lets the hub fetch it. The publisher (the feeds server) only
 * knows the username, never the plaintext password, so matching ignores the
 * password and normalises the encodings clients are known to vary.
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
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
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
  return `${decodeOr(url.username)}@${url.host}${path}${url.search}`;
}

export function topicHostname(topic: string): string | null {
  return parseHttp(topic)?.hostname ?? null;
}

/** `fetch` rejects URLs with credentials, so split them into a header. */
export function fetchTarget(topic: string): {
  url: string;
  authorization?: string;
} {
  const url = new URL(topic);
  const user = decodeOr(url.username);
  const pass = decodeOr(url.password);
  url.username = "";
  url.password = "";
  if (!user && !pass) return { url: url.toString() };
  return {
    url: url.toString(),
    authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
  };
}

export function redact(topic: string): string {
  const url = parseHttp(topic);
  if (!url || !url.password) return topic;
  url.password = "***";
  return url.toString();
}
