/**
 * WebSub announcements. Announcements use each feed's secret address (see
 * secret-urls.ts): the hub fetches whatever it is told to subscribe to, and
 * a secret address carries no password to hand it. A feed whose owner has no
 * token yet (none issued) is skipped — there is no secret address to
 * announce.
 */
import { secretFeedPath } from "./secret-urls.ts";
import type { FeedKey } from "./store.ts";

export type HubConfig = {
  /** Public origin of this server, e.g. https://owntube.nedworks.org */
  publicUrl: string;
  /** Where to POST announcements (the hub, possibly its internal address). */
  publishUrl: string;
  token: string;
};

export function hubTopicUrls(
  publicUrl: string,
  feed: FeedKey,
  token: string,
): string[] {
  const origin = new URL(publicUrl).origin;
  return (["audio", "video"] as const).map(
    (variant) =>
      `${origin}${secretFeedPath(token, feed.kind, feed.slug, variant)}`,
  );
}

/** The hub caps request bodies (64 KiB); keep each POST well under that
 * regardless of how many feeds changed in one publish. */
const MAX_URLS_PER_POST = 100;

export async function notifyHub(
  config: HubConfig,
  feeds: FeedKey[],
  tokenFor: (owner: string) => string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const urls = feeds.flatMap((feed) => {
    const token = tokenFor(feed.owner);
    return token === null ? [] : hubTopicUrls(config.publicUrl, feed, token);
  });
  if (urls.length === 0) return;
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_POST) {
    const chunk = urls.slice(i, i + MAX_URLS_PER_POST);
    const body = new URLSearchParams({ "hub.mode": "publish" });
    for (const url of chunk) body.append("hub.url", url);
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
}
