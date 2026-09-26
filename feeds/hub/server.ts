/**
 * WebSub hub for OwnTube's podcast feeds — websub.nedworks.org.
 *
 *   POST /        WebSub requests (application/x-www-form-urlencoded):
 *                 hub.mode=subscribe|unsubscribe (anyone; intent-verified)
 *                 hub.mode=publish (Bearer HUB_PUBLISH_TOKEN)
 *   GET  /health  liveness
 */
import http from "node:http";
import { Hub } from "./hub.ts";
import { callbackIsPublic, publicOnlyFetch } from "./safety.ts";
import { SubscriptionStore } from "./store.ts";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const HUB_URL = process.env.HUB_URL?.trim() ?? "";
const PUBLISH_TOKEN = process.env.HUB_PUBLISH_TOKEN?.trim() ?? "";
const TOPIC_HOSTS = (process.env.HUB_TOPIC_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const MAX_BODY_BYTES = 64 * 1024;

function logLine(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

if (!HUB_URL || !PUBLISH_TOKEN || TOPIC_HOSTS.length === 0) {
  process.stderr.write(
    "websub-hub: HUB_URL, HUB_PUBLISH_TOKEN and HUB_TOPIC_HOSTS must be set\n",
  );
  process.exit(1);
}

const store = new SubscriptionStore(DATA_DIR);
const hub = new Hub({
  store,
  hubUrl: HUB_URL,
  publishToken: PUBLISH_TOKEN,
  topicHosts: TOPIC_HOSTS,
  isCallbackAllowed: (callback) => callbackIsPublic(callback),
  fetch: publicOnlyFetch,
  log: logLine,
});

setInterval(() => {
  const pruned = store.pruneExpired(Math.floor(Date.now() / 1000));
  if (pruned > 0) logLine(`pruned ${pruned} expired subscription(s)`);
}, 3_600_000).unref();

type ReadBodyResult = { tooLarge: true } | { tooLarge: false; body: string };

/** Reads the request body, capped at MAX_BODY_BYTES. On overflow it stops
 * buffering (rather than destroying the socket) so the caller can still send
 * a 413 response on the same connection. */
function readBody(req: http.IncomingMessage): Promise<ReadBodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      resolve(tooLarge ? { tooLarge: true } : { tooLarge: false, body: Buffer.concat(chunks).toString("utf8") });
    });
    req.on("error", reject);
  });
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
    if (method === "GET" && pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("WebSub hub (https://www.w3.org/TR/websub/). POST hub.mode=subscribe here.\n");
      return;
    }
    if (method === "POST" && pathname === "/") {
      const read = await readBody(req);
      if (read.tooLarge) {
        res.writeHead(413, { "content-type": "text/plain" });
        res.end("request body too large\n");
        return;
      }
      const form = new URLSearchParams(read.body);
      const result = await hub.handle(form, req.headers.authorization);
      res.writeHead(result.status, { "content-type": "text/plain" });
      res.end(result.body);
      if (result.after) {
        result.after().catch((error: unknown) => {
          logLine(`background work failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  })().catch((error: unknown) => {
    process.stderr.write(
      `websub-hub request failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("internal error\n");
  });
});

server.listen(PORT, () => {
  logLine(`websub-hub listening on :${PORT} as ${HUB_URL} (topics: ${TOPIC_HOSTS.join(", ")})`);
});
