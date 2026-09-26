/**
 * OwnTube feeds server — the public RSS mirror.
 *
 *   POST /publish                          push feed snapshots + user credentials (Bearer PUBLISH_SECRET)
 *   GET  /rss/<kind>/<slug>.audio.xml      podcast RSS, audio enclosures (Basic Auth)
 *   GET  /rss/<kind>/<slug>.video.xml      podcast RSS, video enclosures (Basic Auth)
 *   GET  /                                 HTML index of your feeds      (Basic Auth)
 *   GET  /opml.xml                         OPML of your feeds            (Basic Auth)
 *   GET  /health                           liveness (no auth)
 *   GET  /websub/callback                  WebSub hub verification (no auth; see websub.ts)
 *   POST /websub/callback                  WebSub notification (hub HMAC signature)
 *   POST /websub/sync                      home: set wanted channels, drain events (Bearer PUBLISH_SECRET)
 *
 * Basic Auth is per user: the publisher pushes each account's username and the
 * SHA-256 of its generated RSS password alongside the snapshots, and every
 * feed route only serves the authenticated owner's feeds. Feed metadata is
 * public-behind-basic-auth; the `<enclosure>` media only streams on the LAN
 * (that origin is unreachable off-LAN), so putting the creds in a podcast app
 * URL (https://user:pass@host/rss/...) is enough.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIpAllowed } from "./ip-allow.ts";
import {
  type FeedSnapshot,
  renderRss,
  type Variant,
  xmlEscape,
} from "./render.ts";
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

const DUMMY_SHA256 = createHash("sha256")
  .update("feeds-server-dummy")
  .digest("hex");

/** The authenticated username, or null. Credentials come from the store
 * (pushed by the feeds pusher); unknown usernames are compared against a dummy
 * digest so timing doesn't reveal which accounts exist. */
function checkBasicAuth(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  const username = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  let user = store.getUser(username);
  // Usernames are full email addresses, percent-encoded inside feed URLs.
  // Some podcast clients forward the URL userinfo without decoding it, so a
  // miss on the raw form retries the decoded one.
  if (!user && username.includes("%")) {
    try {
      user = store.getUser(decodeURIComponent(username));
    } catch {
      /* not valid percent-encoding — fall through to the dummy compare */
    }
  }
  const digest = createHash("sha256").update(pass, "utf8").digest("hex");
  const ok = safeEqual(digest, user?.passSha256 ?? DUMMY_SHA256);
  return ok && user ? user.username : null;
}

function requireBasicAuth(res: http.ServerResponse): void {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="OwnTube", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
  });
  res.end("authentication required\n");
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
    /^[0-9a-f]{64}$/.test(c.passSha256)
  );
}

function selfUrl(req: http.IncomingMessage): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ||
    req.headers.host ||
    "";
  return `${proto}://${host}${req.url ?? ""}`;
}

function sendXml(res: http.ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    "content-type": "application/rss+xml; charset=utf-8",
    "cache-control": "public, max-age=300",
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
  const { upserted } = store.replaceAll(
    feeds as FeedSnapshot[],
    pubUsers as UserCredential[],
  );
  const items = (feeds as FeedSnapshot[]).reduce(
    (n, f) => n + f.items.length,
    0,
  );
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, feeds: upserted, items }));
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

/** Parse `/rss/<kind>/<slug>.<variant>.xml`. */
function parseRssPath(
  pathname: string,
): { kind: string; slug: string; variant: Variant } | null {
  const m = pathname.match(/^\/rss\/([^/]+)\/(.+)\.(audio|video)\.xml$/);
  if (!m) return null;
  return {
    kind: decodeURIComponent(m[1]),
    slug: decodeURIComponent(m[2]),
    variant: m[3] as Variant,
  };
}

function feedUrl(kind: string, slug: string, variant: Variant): string {
  return `/rss/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}.${variant}.xml`;
}

function renderIndexHtml(owner: string): string {
  const rows = store.list(owner);
  const items = rows
    .map((r) => {
      const a = feedUrl(r.kind, r.slug, "audio");
      const v = feedUrl(r.kind, r.slug, "video");
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
<body><h1>OwnTube feeds</h1><p><a href="/opml.xml">OPML</a> · ${rows.length} feeds</p>
<ul>\n${items}\n</ul></body></html>\n`;
}

function renderOpml(req: http.IncomingMessage, owner: string): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ||
    req.headers.host ||
    "";
  const base = `${proto}://${host}`;
  const outlines = store
    .list(owner)
    .flatMap((r) =>
      (["audio", "video"] as Variant[]).map((variant) => {
        const url = `${base}${feedUrl(r.kind, r.slug, variant)}`;
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

    // Everything below is Basic-Auth guarded and scoped to the
    // authenticated user's own feeds.
    if (method === "GET" || method === "HEAD") {
      const owner = checkBasicAuth(req);
      if (!owner) {
        requireBasicAuth(res);
        return;
      }

      const rss = parseRssPath(pathname);
      if (rss) {
        const feed = store.get(owner, rss.kind, rss.slug);
        if (!feed) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("feed not found\n");
          return;
        }
        sendXml(res, renderRss(feed, rss.variant, { selfUrl: selfUrl(req) }));
        return;
      }

      if (pathname === "/opml.xml") {
        res.writeHead(200, { "content-type": "text/x-opml; charset=utf-8" });
        res.end(renderOpml(req, owner));
        return;
      }

      if (pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderIndexHtml(owner));
        return;
      }
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
  if (WEBSUB_CALLBACK_URL) {
    logLine(
      `feeds-server: WebSub on — callback ${WEBSUB_CALLBACK_URL}, hub ${WEBSUB_HUB_URL}`,
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
    logLine("feeds-server: WebSub off (WEBSUB_CALLBACK_URL unset)");
  }
});
