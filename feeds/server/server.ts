/**
 * OwnTube feeds server — the public RSS mirror.
 *
 *   POST /publish                              push feed snapshots + user credentials (Bearer PUBLISH_SECRET)
 *   GET  /rss/<token>/<kind>/<slug>.audio.xml  podcast RSS, audio enclosures (secret address)
 *   GET  /rss/<token>/<kind>/<slug>.video.xml  podcast RSS, video enclosures (secret address)
 *   GET  /rss/<token>/                         HTML index of that user's feeds (secret address)
 *   GET  /rss/<token>/opml.xml                 OPML of that user's feeds (secret address)
 *   GET  /health                               liveness (no auth)
 *   GET  /websub/callback                      YouTube WebSub subscription verification (no auth; see websub.ts)
 *   POST /websub/callback                      YouTube WebSub upload notification (hub HMAC signature)
 *   POST /websub/sync                          home: set wanted channels, drain events (Bearer PUBLISH_SECRET)
 *
 * Every feed lives at a secret address: an opaque per-user token (see
 * secret-urls.ts) stands in for a password, so a podcast app URL never
 * carries credentials. The publisher pushes each account's token alongside
 * its snapshots, and every secret route only serves that token's owner's
 * feeds. Feed metadata is public-behind-an-unguessable-token; the
 * `<enclosure>` media only streams on the LAN (that origin is unreachable
 * off-LAN).
 *
 * With a WebSub hub configured (HUB_URL/HUB_PUBLISH_TOKEN/PUBLIC_URL), each
 * feed's own `<atom:link rel="self">` is that exact secret address — it is
 * the WebSub topic the hub fetches, so it must be exact.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIpAllowed } from "./ip-allow.ts";
import { type HubConfig, notifyHub } from "./notify-hub.ts";
import {
  type FeedSnapshot,
  renderRss,
  type Variant,
  xmlEscape,
} from "./render.ts";
import {
  parseSecretPath,
  redactToken,
  secretFeedPath,
  TOKEN_RE,
} from "./secret-urls.ts";
import { FeedStore, type UserCredential } from "./store.ts";
import {
  channelIdFromTopic,
  DEFAULT_HUB_URL,
  hubRequestBody,
  isChannelId,
  parseNotification,
  verifySignature,
} from "./websub.ts";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const PUBLISH_SECRET = process.env.PUBLISH_SECRET ?? "";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

// Optional IP allow-list for /publish — defense-in-depth atop the Bearer secret.
// Hostnames are re-resolved periodically so a DDNS home IP keeps working; if
// neither var is set the check is disabled (Bearer only).
const PUBLISH_ALLOW_HOSTS = (process.env.PUBLISH_ALLOW_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PUBLISH_ALLOW_IPS = (process.env.PUBLISH_ALLOW_IPS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const IP_ALLOWLIST_ON =
  PUBLISH_ALLOW_HOSTS.length > 0 || PUBLISH_ALLOW_IPS.length > 0;

// WebSub: on only when all three are set. HUB_URL is advertised in every feed;
// HUB_PUBLISH_URL is where announcements go (the hub's internal address on the
// shared Docker network, defaulting to HUB_URL).
const HUB_URL = process.env.HUB_URL?.trim() ?? "";
const HUB_PUBLISH_TOKEN = process.env.HUB_PUBLISH_TOKEN?.trim() ?? "";
const PUBLIC_URL = process.env.PUBLIC_URL?.trim() ?? "";
const hub: HubConfig | null =
  HUB_URL && HUB_PUBLISH_TOKEN && PUBLIC_URL
    ? {
        publicUrl: PUBLIC_URL,
        publishUrl: process.env.HUB_PUBLISH_URL?.trim() || HUB_URL,
        token: HUB_PUBLISH_TOKEN,
      }
    : null;
if (HUB_URL && !hub) {
  process.stderr.write(
    "feeds-server: HUB_URL needs HUB_PUBLISH_TOKEN and PUBLIC_URL\n",
  );
  process.exit(1);
}
if (hub) {
  let publicUrlOk = false;
  try {
    publicUrlOk = new URL(hub.publicUrl).pathname === "/";
  } catch {
    publicUrlOk = false;
  }
  if (!publicUrlOk) {
    process.stderr.write(
      `feeds-server: PUBLIC_URL must be a valid origin with no path, e.g. https://owntube.example (got ${JSON.stringify(hub.publicUrl)})\n`,
    );
    process.exit(1);
  }
}

// WebSub push for YouTube uploads (see websub.ts). Off unless the public
// callback URL is configured — the hub must be able to reach it.
const WEBSUB_CALLBACK_URL = process.env.WEBSUB_CALLBACK_URL?.trim() ?? "";
const WEBSUB_HUB_URL = process.env.WEBSUB_HUB_URL?.trim() || DEFAULT_HUB_URL;
// `hub.secret` for notification signatures. Derived from PUBLISH_SECRET unless
// set, so enabling WebSub needs no new secret.
const WEBSUB_SECRET =
  process.env.WEBSUB_SECRET?.trim() ||
  createHmac("sha256", PUBLISH_SECRET).update("websub").digest("hex");
const WEBSUB_TICK_MS = 60_000;
/** Hub requests per tick: a fresh 200-channel set subscribes in ~8 minutes. */
const WEBSUB_REQUESTS_PER_TICK = 25;
const WEBSUB_SYNC_BATCH = 500;
const MAX_WEBSUB_BODY_BYTES = 1024 * 1024;
const MAX_WEBSUB_CHANNELS = 10_000;

if (!PUBLISH_SECRET) {
  process.stderr.write("feeds-server: PUBLISH_SECRET must be set\n");
  process.exit(1);
}

const store = new FeedStore(DATA_DIR);

// The OwnTube icon, served at /icon.png as permanent podcast cover art. Loaded
// once at startup; absent (unusual deploy) the route just 404s.
let iconPng: Buffer | null = null;
try {
  iconPng = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "icon.png"),
  );
} catch {
  /* no icon shipped */
}

function logLine(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/**
 * Client IP from the rightmost X-Forwarded-For entry (added by our trusted
 * Caddy), falling back to the socket. Rightmost is spoof-resistant: an external
 * client can only *prepend* XFF values; Caddy appends the address it actually
 * saw the connection from.
 */
function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : (xff ?? "");
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return req.socket.remoteAddress ?? "";
}

let allowCache: { at: number; ips: string[] } = { at: 0, ips: [] };
const ALLOW_RESOLVE_TTL_MS = 60_000;

/**
 * Static IP/CIDR rules plus freshly-resolved hostname IPs (A+AAAA), cached ~60s
 * so a DDNS home IP is tracked without hammering DNS. On resolver failure the
 * last good resolution is reused rather than locking the publisher out.
 */
async function currentAllowRules(): Promise<string[]> {
  if (PUBLISH_ALLOW_HOSTS.length === 0) return PUBLISH_ALLOW_IPS;
  const now = Date.now();
  if (now - allowCache.at < ALLOW_RESOLVE_TTL_MS && allowCache.ips.length) {
    return [...PUBLISH_ALLOW_IPS, ...allowCache.ips];
  }
  const ips: string[] = [];
  for (const host of PUBLISH_ALLOW_HOSTS) {
    try {
      const recs = await dns.lookup(host, { all: true });
      for (const r of recs) ips.push(r.address);
    } catch {
      /* skip this host; fall back to cached ips below */
    }
  }
  if (ips.length) allowCache = { at: now, ips };
  return [...PUBLISH_ALLOW_IPS, ...(ips.length ? ips : allowCache.ips)];
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function checkBearer(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? safeEqual(m[1], PUBLISH_SECRET) : false;
}

function readBody(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isFeedSnapshot(v: unknown): v is FeedSnapshot {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.kind === "string" &&
    typeof f.owner === "string" &&
    f.owner.length > 0 &&
    typeof f.slug === "string" &&
    typeof f.title === "string" &&
    typeof f.updatedAt === "number" &&
    Array.isArray(f.items)
  );
}

function isUserCredential(v: unknown): v is UserCredential {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.username === "string" &&
    c.username.length > 0 &&
    typeof c.passSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(c.passSha256) &&
    (c.feedToken === undefined ||
      (typeof c.feedToken === "string" && TOKEN_RE.test(c.feedToken)))
  );
}

function originOf(req: http.IncomingMessage): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ||
    req.headers.host ||
    "";
  return `${proto}://${host}`;
}

function sendXml(res: http.ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    "content-type": "application/rss+xml; charset=utf-8",
    // Per-user content on a shared path (and, with a hub, a body that embeds
    // the requester's own password in the self link): never cacheable by a
    // shared/intermediate cache, only by the requesting client itself.
    "cache-control": "private, max-age=300",
  });
  res.end(body);
}

/** The home publisher's routes: IP allow-list (when on) plus Bearer secret.
 * Writes the rejection and returns false when either fails. */
async function authorizePublisher(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (IP_ALLOWLIST_ON) {
    const ip = clientIp(req);
    const rules = await currentAllowRules();
    if (!isIpAllowed(ip, rules)) {
      logLine(`${req.url} DENIED: ${ip} not in allow-list`);
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden\n");
      return false;
    }
  }
  if (!checkBearer(req)) {
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("unauthorized\n");
    return false;
  }
  return true;
}

async function handlePublish(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!(await authorizePublisher(req, res))) return;
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("invalid json\n");
    return;
  }
  const feeds = (payload as { feeds?: unknown })?.feeds;
  const pubUsers = (payload as { users?: unknown })?.users;
  if (
    !Array.isArray(feeds) ||
    !feeds.every(isFeedSnapshot) ||
    !Array.isArray(pubUsers) ||
    !pubUsers.every(isUserCredential)
  ) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("expected { feeds: FeedSnapshot[], users: UserCredential[] }\n");
    return;
  }
  const { upserted, changed } = store.replaceAll(
    feeds as FeedSnapshot[],
    pubUsers as UserCredential[],
  );
  const items = (feeds as FeedSnapshot[]).reduce(
    (n, f) => n + f.items.length,
    0,
  );
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, feeds: upserted, items }));
  // Announce after responding: a hub outage must never fail a publish.
  if (hub && changed.length > 0) {
    notifyHub(hub, changed, (o) => store.tokenFor(o)).then(
      () => logLine(`hub notified: ${changed.length} changed feed(s)`),
      (error: unknown) =>
        logLine(
          `hub notify failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sendText(
  res: http.ServerResponse,
  status: number,
  body: string,
): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

/** Hub verification of a (un)subscribe request: echo `hub.challenge` to accept. */
function handleWebSubVerify(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const q = new URL(req.url ?? "/", "http://x").searchParams;
  const mode = q.get("hub.mode");
  const channelId = channelIdFromTopic(q.get("hub.topic") ?? "");
  if (!channelId) {
    sendText(res, 404, "unknown topic\n");
    return;
  }
  if (mode === "denied") {
    store.markWebSubDenied(channelId, q.get("hub.reason") ?? "");
    logLine(`websub: hub denied ${channelId}: ${q.get("hub.reason") ?? ""}`);
    sendText(res, 200, "ok\n");
    return;
  }
  const challenge = q.get("hub.challenge") ?? "";
  if (
    (mode !== "subscribe" && mode !== "unsubscribe") ||
    !challenge ||
    challenge.length > 1024
  ) {
    sendText(res, 400, "bad request\n");
    return;
  }
  const lease = Number.parseInt(q.get("hub.lease_seconds") ?? "", 10);
  const ok = store.verifyWebSub(
    channelId,
    mode,
    Number.isFinite(lease) ? lease : 432_000,
    nowSec(),
  );
  if (!ok) {
    sendText(res, 404, "not wanted\n");
    return;
  }
  sendText(res, 200, challenge);
}

/**
 * Hub notification. Always 2xx once read (the WebSub spec: a non-2xx only
 * makes the hub retry); bad signatures and unwanted channels are dropped.
 */
async function handleWebSubNotify(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: Buffer;
  try {
    body = await readBody(req, MAX_WEBSUB_BODY_BYTES);
  } catch {
    sendText(res, 413, "too large\n");
    return;
  }
  const signature = req.headers["x-hub-signature"];
  if (
    !verifySignature(
      body,
      Array.isArray(signature) ? signature[0] : signature,
      WEBSUB_SECRET,
    )
  ) {
    logLine("websub: notification with bad signature dropped");
    sendText(res, 202, "ignored\n");
    return;
  }
  const events = parseNotification(body.toString("utf8")).filter((e) =>
    store.isWebSubWanted(e.channelId),
  );
  const added = store.addWebSubEvents(events, nowSec());
  if (added > 0) {
    logLine(
      `websub: queued ${events.map((e) => `${e.deleted ? "-" : "+"}${e.videoId}@${e.channelId}`).join(" ")}`,
    );
  }
  sendText(res, 202, "ok\n");
}

/**
 * Home's single round trip: `{ channels, ack }` in → wanted set replaced,
 * events up to `ack` deleted → next batch of events out. Home acks a batch on
 * its next call, so a crash mid-apply redelivers rather than loses.
 */
async function handleWebSubSync(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!(await authorizePublisher(req, res))) return;
  let payload: { channels?: unknown; ack?: unknown };
  try {
    payload = JSON.parse(
      (await readBody(req, MAX_WEBSUB_BODY_BYTES)).toString("utf8"),
    );
  } catch {
    sendText(res, 400, "invalid json\n");
    return;
  }
  const { channels, ack } = payload ?? {};
  if (
    !Array.isArray(channels) ||
    channels.length > MAX_WEBSUB_CHANNELS ||
    !channels.every(isChannelId) ||
    (ack !== undefined && ack !== null && !Number.isSafeInteger(ack))
  ) {
    sendText(res, 400, "expected { channels: string[], ack?: number }\n");
    return;
  }
  store.setWebSubWanted(channels as string[]);
  const now = nowSec();
  const events = store.drainWebSubEvents(
    (ack as number | null | undefined) ?? null,
    WEBSUB_SYNC_BATCH,
    now,
  );
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      events,
      stats: store.webSubStats(now),
    }),
  );
}

/** One pass of hub (un)subscribe requests; see `FeedStore.webSubDue`. */
async function webSubTick(): Promise<void> {
  const now = nowSec();
  const due = store.webSubDue(now, WEBSUB_REQUESTS_PER_TICK);
  const requests = [
    ...due.subscribe.map((id) => ["subscribe", id] as const),
    ...due.unsubscribe.map((id) => ["unsubscribe", id] as const),
  ];
  for (const [mode, channelId] of requests) {
    let error: string | null = null;
    try {
      const resp = await fetch(WEBSUB_HUB_URL, {
        method: "POST",
        body: hubRequestBody(
          mode,
          channelId,
          WEBSUB_CALLBACK_URL,
          WEBSUB_SECRET,
        ),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        error = `hub ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    store.markWebSubRequested(channelId, mode, nowSec(), error);
    if (error) logLine(`websub: ${mode} ${channelId} failed — ${error}`);
  }
  if (requests.length > 0) {
    logLine(
      `websub: requested ${due.subscribe.length} subscribe, ${due.unsubscribe.length} unsubscribe`,
    );
  }
}

function renderIndexHtml(owner: string, token: string): string {
  const rows = store.list(owner);
  const items = rows
    .map((r) => {
      const a = secretFeedPath(token, r.kind, r.slug, "audio");
      const v = secretFeedPath(token, r.kind, r.slug, "video");
      return `<li><strong>${xmlEscape(r.title)}</strong> <span class="kind">${xmlEscape(r.kind)}</span> · ${r.feed.items.length} items<br><a href="${a}">audio</a> · <a href="${v}">video</a></li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OwnTube feeds</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.4rem}ul{list-style:none;padding:0}li{padding:.6rem 0;border-bottom:1px solid #8883}
.kind{font-size:.75rem;opacity:.6;text-transform:uppercase}a{margin-right:.3rem}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style></head>
<body><h1>OwnTube feeds</h1><p><a href="/rss/${token}/opml.xml">OPML</a> · ${rows.length} feeds</p>
<ul>\n${items}\n</ul></body></html>\n`;
}

function renderOpml(
  req: http.IncomingMessage,
  owner: string,
  token: string,
): string {
  const base = originOf(req);
  const outlines = store
    .list(owner)
    .flatMap((r) =>
      (["audio", "video"] as Variant[]).map((variant) => {
        const url = `${base}${secretFeedPath(token, r.kind, r.slug, variant)}`;
        const text = `${r.title} (${variant})`;
        return `    <outline type="rss" text="${xmlEscape(text)}" title="${xmlEscape(text)}" xmlUrl="${xmlEscape(url)}"/>`;
      }),
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>OwnTube feeds</title></head>
<body>\n${outlines}\n</body></opml>\n`;
}

const server = http.createServer((req, res) => {
  void (async () => {
    const method = req.method ?? "GET";
    const pathname = (req.url ?? "/").split("?")[0];

    if (method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }

    // Permanent podcast cover art. Unauthenticated: podcast platforms fetch
    // cover art server-side without the feed's credentials.
    if ((method === "GET" || method === "HEAD") && pathname === "/icon.png") {
      if (!iconPng) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no icon\n");
        return;
      }
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": iconPng.length,
        "cache-control": "public, max-age=86400",
      });
      res.end(method === "HEAD" ? undefined : iconPng);
      return;
    }

    // Podcasting 2.0 JSON chapters, referenced from feed items. Deliberately
    // unauthenticated: podcast apps fetch this URL bare (feed credentials are
    // not applied to linked resources), and the content is YouTube's public
    // chapter data keyed by public video id — nothing about the user in it.
    if (method === "GET" || method === "HEAD") {
      const chapters = pathname.match(
        /^\/chapters\/([A-Za-z0-9_-]{6,32})\.json$/,
      );
      if (chapters) {
        const list = store.chaptersFor(chapters[1]);
        if (!list) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("no chapters\n");
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json+chapters",
          "cache-control": "public, max-age=3600",
        });
        res.end(
          JSON.stringify({
            version: "1.2.0",
            chapters: list.map((c) => ({
              startTime: c.startSeconds,
              title: c.title,
            })),
          }),
        );
        return;
      }
    }

    // Secret feed addresses: a per-user token unlocks that user's feeds with
    // no password at all. See secret-urls.ts.
    if (method === "GET" || method === "HEAD") {
      const secret = parseSecretPath(pathname);
      if (secret) {
        const user = store.getUserByToken(secret.token);
        logLine(
          `rss ${method} /rss/${redactToken(secret.token)}/… secret owner=${user?.username ?? "unknown"} ip=${clientIp(req)} ua=${JSON.stringify(req.headers["user-agent"] ?? "")}`,
        );
        if (!user) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found\n");
          return;
        }
        const owner = user.username;
        if ("variant" in secret) {
          const feed = store.get(owner, secret.kind, secret.slug);
          if (!feed) {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("feed not found\n");
            return;
          }
          const self = new URL(
            secretFeedPath(
              secret.token,
              secret.kind,
              secret.slug,
              secret.variant,
            ),
            hub?.publicUrl ?? originOf(req),
          ).href;
          sendXml(
            res,
            renderRss(feed, secret.variant, {
              selfUrl: self,
              hubUrl: hub ? HUB_URL : undefined,
            }),
          );
          return;
        }
        if (secret.page === "index") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            // Every link on the page embeds the token: never cache beyond
            // the requesting client, same as the secret feed routes.
            "cache-control": "private, max-age=300",
          });
          res.end(renderIndexHtml(owner, secret.token));
          return;
        }
        res.writeHead(200, {
          "content-type": "text/x-opml; charset=utf-8",
          "cache-control": "private, max-age=300",
        });
        res.end(renderOpml(req, owner, secret.token));
        return;
      }
    }

    if (method === "POST" && pathname === "/publish") {
      await handlePublish(req, res);
      return;
    }

    if (WEBSUB_CALLBACK_URL && pathname === "/websub/callback") {
      if (method === "GET") {
        handleWebSubVerify(req, res);
        return;
      }
      if (method === "POST") {
        await handleWebSubNotify(req, res);
        return;
      }
    }

    if (
      WEBSUB_CALLBACK_URL &&
      method === "POST" &&
      pathname === "/websub/sync"
    ) {
      await handleWebSubSync(req, res);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`feeds-server request failed: ${message}\n`);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("internal error\n");
  });
});

server.listen(PORT, () => {
  logLine(`feeds-server listening on :${PORT} (data: ${DATA_DIR})`);
  if (IP_ALLOWLIST_ON) {
    logLine(
      `feeds-server: /publish IP allow-list ON — hosts=[${PUBLISH_ALLOW_HOSTS.join(", ")}] ips=[${PUBLISH_ALLOW_IPS.join(", ")}]`,
    );
  } else {
    logLine("feeds-server: /publish IP allow-list off (Bearer only)");
  }
  logLine(
    hub
      ? `feeds-server: WebSub hub ${HUB_URL}`
      : "feeds-server: WebSub hub off (HUB_URL unset)",
  );
  if (WEBSUB_CALLBACK_URL) {
    logLine(
      `feeds-server: YouTube WebSub subscriber on — callback ${WEBSUB_CALLBACK_URL}, hub ${WEBSUB_HUB_URL}`,
    );
    let running = false;
    const tick = () => {
      if (running) return;
      running = true;
      webSubTick()
        .catch((e: unknown) =>
          logLine(
            `websub: tick failed — ${e instanceof Error ? e.message : String(e)}`,
          ),
        )
        .finally(() => {
          running = false;
        });
    };
    setInterval(tick, WEBSUB_TICK_MS).unref();
    tick();
  } else {
    logLine(
      "feeds-server: YouTube WebSub subscriber off (WEBSUB_CALLBACK_URL unset)",
    );
  }
});
