/**
 * Snapshot → podcast RSS. Pure functions, no I/O. A feed snapshot is whatever
 * the LAN OwnTube publisher pushed (see owntube `server/remote/publish.ts`);
 * the feeds server only stores and renders it. Every `<enclosure>` URL already
 * points at the LAN media origin and is embedded verbatim.
 */

export type FeedItem = {
  videoId: string;
  title: string;
  description?: string;
  durationSeconds?: number;
  publishedAt?: number;
  thumbnailUrl?: string;
  channelName?: string;
  enclosureAudio: string;
  enclosureVideo: string;
  /** YouTube-style chapters (from the video description), served as
   * Podcasting 2.0 JSON chapters at /chapters/<videoId>.json. */
  chapters?: { startSeconds: number; title: string }[];
};

export type FeedSnapshot = {
  kind: string;
  /** Basic-Auth username whose credentials unlock this feed. */
  owner: string;
  slug: string;
  title: string;
  description?: string;
  link?: string;
  image?: string;
  updatedAt: number;
  items: FeedItem[];
};

export type Variant = "audio" | "video";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function xmlEscape(input: string | undefined): string {
  if (!input) return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Unix seconds → RFC-822 date (GMT), the format RSS `<pubDate>` requires. */
export function rfc822(unixSeconds: number | undefined): string {
  const d = new Date((unixSeconds ?? 0) * 1000);
  const day = DAYS[d.getUTCDay()];
  const date = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${day}, ${date} ${month} ${year} ${hh}:${mm}:${ss} GMT`;
}

/** Seconds → H:MM:SS (or M:SS) for `<itunes:duration>`. */
export function hms(seconds: number | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function watchLinkFromEnclosure(
  enclosureUrl: string,
  videoId: string,
): string | null {
  try {
    return `${new URL(enclosureUrl).origin}/watch?v=${encodeURIComponent(videoId)}`;
  } catch {
    return null;
  }
}

function renderItem(
  item: FeedItem,
  variant: Variant,
  chaptersBase?: string,
): string {
  const enclosureUrl =
    variant === "audio" ? item.enclosureAudio : item.enclosureVideo;
  const mime = variant === "audio" ? "audio/mp4" : "video/mp4";
  const watchLink = watchLinkFromEnclosure(enclosureUrl, item.videoId);
  const parts = [
    "    <item>",
    `      <title>${xmlEscape(item.title)}</title>`,
    `      <guid isPermaLink="false">${xmlEscape(item.videoId)}</guid>`,
  ];
  if (item.publishedAt)
    parts.push(`      <pubDate>${rfc822(item.publishedAt)}</pubDate>`);
  if (watchLink) parts.push(`      <link>${xmlEscape(watchLink)}</link>`);
  if (item.description) {
    parts.push(
      `      <description>${xmlEscape(item.description)}</description>`,
    );
    parts.push(
      `      <content:encoded><![CDATA[${item.description.replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>`,
    );
  }
  if (item.channelName) {
    parts.push(
      `      <itunes:author>${xmlEscape(item.channelName)}</itunes:author>`,
    );
  }
  if (typeof item.durationSeconds === "number") {
    parts.push(
      `      <itunes:duration>${hms(item.durationSeconds)}</itunes:duration>`,
    );
  }
  if (item.thumbnailUrl) {
    parts.push(`      <itunes:image href="${xmlEscape(item.thumbnailUrl)}"/>`);
  }
  if (chaptersBase && item.chapters && item.chapters.length > 0) {
    parts.push(
      `      <podcast:chapters url="${xmlEscape(`${chaptersBase}/chapters/${encodeURIComponent(item.videoId)}.json`)}" type="application/json+chapters"/>`,
    );
  }
  // length="0": the enclosure is resolved on demand (signed, expiring stream),
  // so the byte length is unknown ahead of time; clients tolerate 0.
  parts.push(
    `      <enclosure url="${xmlEscape(enclosureUrl)}" type="${mime}" length="0"/>`,
  );
  parts.push("    </item>");
  return parts.join("\n");
}

export type RenderOptions = {
  /** Absolute URL this feed is served at (for `<atom:link rel="self">`). */
  selfUrl?: string;
  /** WebSub hub to advertise (`<atom:link rel="hub">`). */
  hubUrl?: string;
  author?: string;
};

export function renderRss(
  feed: FeedSnapshot,
  variant: Variant,
  options: RenderOptions = {},
): string {
  const author = options.author ?? "OwnTube";
  const title = `${feed.title}${variant === "audio" ? "" : " (Video)"}`;
  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">',
    "  <channel>",
    `    <title>${xmlEscape(title)}</title>`,
    `    <description>${xmlEscape(feed.description ?? feed.title)}</description>`,
    feed.link
      ? `    <link>${xmlEscape(feed.link)}</link>`
      : "    <link>about:blank</link>",
    "    <language>en</language>",
    `    <lastBuildDate>${rfc822(feed.updatedAt)}</lastBuildDate>`,
    `    <itunes:author>${xmlEscape(author)}</itunes:author>`,
    "    <itunes:explicit>false</itunes:explicit>",
    '    <itunes:category text="TV &amp; Film"/>',
  ];
  if (options.selfUrl) {
    head.push(
      `    <atom:link href="${xmlEscape(options.selfUrl)}" rel="self" type="application/rss+xml"/>`,
    );
  }
  if (options.hubUrl) {
    head.push(`    <atom:link href="${xmlEscape(options.hubUrl)}" rel="hub"/>`);
  }
  // Both the chapters JSON and the cover art are served from this same host, so
  // derive the origin from the self URL and no extra configuration is needed.
  let publicBase: string | undefined;
  if (options.selfUrl) {
    try {
      publicBase = new URL(options.selfUrl).origin;
    } catch {
      /* relative/odd self URL — items simply omit chapters */
    }
  }
  // Fall back to the permanent /icon.png this server already publishes
  // unauthenticated. Without a channel image a feed has no cover art at all:
  // podcast platforms fetch artwork server-side, off the LAN and without the
  // feed's credentials, so anything private is unreachable to them and they
  // store the podcast with no image. That is why the OwnTube logo was missing.
  const image = feed.image ?? (publicBase ? `${publicBase}/icon.png` : undefined);
  if (image) {
    head.push(`    <itunes:image href="${xmlEscape(image)}"/>`);
    head.push("    <image>");
    head.push(`      <url>${xmlEscape(image)}</url>`);
    head.push(`      <title>${xmlEscape(title)}</title>`);
    if (feed.link) head.push(`      <link>${xmlEscape(feed.link)}</link>`);
    head.push("    </image>");
  }
  const chaptersBase = publicBase;
  const items = feed.items.map((it) => renderItem(it, variant, chaptersBase));
  return `${head.join("\n")}\n${items.join("\n")}\n  </channel>\n</rss>\n`;
}
