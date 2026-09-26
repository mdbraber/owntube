/**
 * WebSub announcements. Feeds are per user and share paths, so a feed's topic
 * URL carries its owner's username (and, in the feed's own self link, the
 * password the client authenticated with). The hub matches announcements on
 * username + URL and fetches each subscription with the credentials it
 * subscribed with — this server never needs the plaintext password.
 */
import type { FeedKey } from "./store.ts";

export type HubConfig = {
  /** Public origin of this server, e.g. https://owntube.nedworks.org */
  publicUrl: string;
  /** Where to POST announcements (the hub, possibly its internal address). */
  publishUrl: string;
  token: string;
};

export function feedTopicUrl(
  publicUrl: string,
  owner: string,
  pathname: string,
  password?: string,
): string {
  const base = new URL(publicUrl);
  const userinfo =
    password === undefined
      ? encodeURIComponent(owner)
      : `${encodeURIComponent(owner)}:${encodeURIComponent(password)}`;
  return `${base.protocol}//${userinfo}@${base.host}${pathname}`;
}

export function hubTopicUrls(publicUrl: string, feed: FeedKey): string[] {
  return (["audio", "video"] as const).map((variant) =>
    feedTopicUrl(
      publicUrl,
      feed.owner,
      `/rss/${encodeURIComponent(feed.kind)}/${encodeURIComponent(feed.slug)}.${variant}.xml`,
    ),
  );
}

export async function notifyHub(
  config: HubConfig,
  feeds: FeedKey[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (feeds.length === 0) return;
  const body = new URLSearchParams({ "hub.mode": "publish" });
  for (const feed of feeds) {
    for (const url of hubTopicUrls(config.publicUrl, feed)) body.append("hub.url", url);
  }
  const res = await fetchImpl(config.publishUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Bearer ${config.token}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`hub ${res.status}`);
}
