/**
 * WebSub (PubSubHubbub) protocol helpers for YouTube upload notifications.
 *
 * YouTube publishes every channel's uploads feed through Google's hub
 * (pubsubhubbub.appspot.com). This server is the *subscriber*: it asks the hub
 * for push delivery of each wanted channel's topic, answers the hub's
 * verification GET, and receives signed Atom notifications on the callback. The
 * home OwnTube (LAN-only, unreachable from the hub) drains the queued events
 * over `POST /websub/sync` — see `server.ts`.
 *
 * Pure functions only; persistence lives in `store.ts`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";
/** What we ask for; the YouTube hub grants ~5 days regardless. */
export const REQUESTED_LEASE_SEC = 432_000;

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;
const VIDEO_ID_RE = /^[0-9A-Za-z_-]{11}$/;

export function isChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID_RE.test(value);
}

export function topicFor(channelId: string): string {
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
}

/** Channel id of a YouTube uploads topic URL, or null for anything else. */
export function channelIdFromTopic(topic: string): string | null {
  let url: URL;
  try {
    url = new URL(topic);
  } catch {
    return null;
  }
  if (
    url.hostname !== "www.youtube.com" ||
    url.pathname !== "/xml/feeds/videos.xml"
  ) {
    return null;
  }
  const id = url.searchParams.get("channel_id");
  return isChannelId(id) ? id : null;
}

/**
 * `X-Hub-Signature: sha1=<hex>` over the raw body, keyed with the `hub.secret`
 * we sent when subscribing. Also accepts sha256 in case the hub upgrades.
 */
export function verifySignature(
  body: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  const m = header?.match(/^(sha1|sha256)=([0-9a-f]+)$/i);
  if (!m) return false;
  const algo = m[1].toLowerCase();
  const expected = createHmac(algo, secret).update(body).digest();
  const given = Buffer.from(m[2].toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type WebSubEvent = {
  channelId: string;
  videoId: string;
  /** Tombstone (`at:deleted-entry`): the video was deleted or made private. */
  deleted: boolean;
  title?: string;
  author?: string;
  /** Unix seconds. */
  publishedAt?: number;
  /** Unix seconds. YouTube also pushes on title/description edits. */
  updatedAt?: number;
};

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** RFC 3339 → unix seconds. YouTube sends nanosecond fractions; trim to ms. */
function parseTime(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw.trim().replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXmlEntities(m[1].trim()) : undefined;
}

/**
 * Parse a YouTube hub notification (Atom). Regex-based like the home RSS
 * parser: the payload is small and machine-generated. Entries that don't carry
 * a well-formed video + channel id are dropped.
 */
export function parseNotification(xml: string): WebSubEvent[] {
  const selfTopic = xml.match(/<link[^>]*rel="self"[^>]*href="([^"]+)"/i)?.[1];
  const selfChannel = selfTopic
    ? channelIdFromTopic(decodeXmlEntities(selfTopic))
    : null;
  const out: WebSubEvent[] = [];

  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const entry = m[1];
    const videoId = tag(entry, "yt:videoId");
    const channelId = tag(entry, "yt:channelId") ?? selfChannel;
    if (!videoId || !VIDEO_ID_RE.test(videoId) || !isChannelId(channelId)) {
      continue;
    }
    out.push({
      channelId,
      videoId,
      deleted: false,
      title: tag(entry, "title"),
      author: tag(
        entry.match(/<author>([\s\S]*?)<\/author>/i)?.[1] ?? "",
        "name",
      ),
      publishedAt: parseTime(tag(entry, "published")),
      updatedAt: parseTime(tag(entry, "updated")),
    });
  }

  for (const m of xml.matchAll(
    /<at:deleted-entry\b([^>]*)>([\s\S]*?)<\/at:deleted-entry>/gi,
  )) {
    const attrs = m[1];
    const body = m[2];
    const videoId = attrs.match(/\bref="yt:video:([^"]+)"/i)?.[1];
    const byUri = tag(body, "uri");
    const channelId =
      byUri?.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/)?.[1] ?? selfChannel;
    if (!videoId || !VIDEO_ID_RE.test(videoId) || !isChannelId(channelId)) {
      continue;
    }
    out.push({
      channelId,
      videoId,
      deleted: true,
      updatedAt: parseTime(attrs.match(/\bwhen="([^"]+)"/i)?.[1]),
    });
  }
  return out;
}

/** Form body for a hub subscribe/unsubscribe request. */
export function hubRequestBody(
  mode: "subscribe" | "unsubscribe",
  channelId: string,
  callbackUrl: string,
  secret: string,
): URLSearchParams {
  return new URLSearchParams({
    "hub.mode": mode,
    "hub.topic": topicFor(channelId),
    "hub.callback": callbackUrl,
    "hub.verify": "async",
    "hub.lease_seconds": String(REQUESTED_LEASE_SEC),
    "hub.secret": secret,
  });
}
