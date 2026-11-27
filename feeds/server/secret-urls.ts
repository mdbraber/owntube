/**
 * Secret feed addresses: a per-user token unlocks that user's feeds without a
 * password (see server.ts's `/rss/<token>/...` routes). Pure path helpers,
 * no I/O, shared by the routes and the hub announcements.
 */

/** A feed token is a 32-char lowercase hex string. */
export const TOKEN_RE = /^[0-9a-f]{32}$/;

export type Variant = "audio" | "video";

export type SecretFeedTarget = {
  token: string;
  kind: string;
  slug: string;
  variant: Variant;
};

export type SecretPageTarget = {
  token: string;
  page: "index" | "opml";
};

/** `/rss/<token>/<kind>/<slug>.<variant>.xml`, kind and slug percent-encoded. */
export function secretFeedPath(
  token: string,
  kind: string,
  slug: string,
  variant: Variant,
): string {
  return `/rss/${token}/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}.${variant}.xml`;
}

/**
 * Parse a request path as a secret address: a feed, the per-user index, or
 * its OPML. Returns null for anything else, including a malformed token.
 */
export function parseSecretPath(
  pathname: string,
): SecretFeedTarget | SecretPageTarget | null {
  const m = pathname.match(/^\/rss\/([0-9a-f]{32})\/(.*)$/);
  if (!m) return null;
  const [, token, rest] = m;
  if (rest === "") return { token, page: "index" };
  if (rest === "opml.xml") return { token, page: "opml" };
  const feed = rest.match(/^([^/]+)\/(.+)\.(audio|video)\.xml$/);
  if (!feed) return null;
  try {
    return {
      token,
      kind: decodeURIComponent(feed[1]),
      slug: decodeURIComponent(feed[2]),
      variant: feed[3] as Variant,
    };
  } catch {
    return null;
  }
}

/** Safe-to-log form of a token: never the full value. */
export function redactToken(token: string): string {
  return `${token.slice(0, 6)}…`;
}

/**
 * Safe-to-log form of a request path: redacts a leading 32-hex token segment
 * (`/rss/<token>` or `/rss/<token>/...`), leaving everything else — including
 * a path that merely *looks* like `/rss/<something>` without a real token —
 * unchanged. Guards against a full token reaching the logs via a path that
 * isn't a recognized secret address (e.g. a malformed one that falls through
 * to another route's own logging).
 */
export function redactPath(pathname: string): string {
  return pathname.replace(
    /^\/rss\/([0-9a-f]{32})(?=\/|$)/,
    (_, token: string) => `/rss/${redactToken(token)}`,
  );
}
