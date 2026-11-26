import { serve } from "@hono/node-server";
import { createEgress } from "@owntube/youtube/egress";
import { SessionPool } from "@owntube/youtube/session";
import { YouTube } from "@owntube/youtube/youtube";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { pruneImages } from "./media/images.ts";
import { diskProgressiveStore } from "./media/progressive-store.ts";
import { PlaybackSessions } from "./media/sessions.ts";

const config = loadConfig();
const egress = createEgress({
  ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
});
const sessions = new PlaybackSessions({
  preferSabr: config.transport === "sabr",
  progressiveStore: diskProgressiveStore(`${config.cacheDir}/progressive`),
  youtube: new YouTube(new SessionPool({ egress })),
});
const imageCacheDir = `${config.cacheDir}/images`;
const app = createApp({
  sessions,
  signingKey: config.signingKey,
  images: { cacheDir: imageCacheDir, fetch: egress.fetch() },
});
setInterval(() => {
  pruneImages(imageCacheDir, config.imageCacheMaxBytes).catch((error: Error) =>
    process.stderr.write(`image cache prune failed: ${error.message}\n`),
  );
}, 60 * 60_000).unref();
const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  (info) => {
    process.stdout.write(`gateway listening on ${info.address}:${info.port}\n`);
  },
);

function shutdown(signal: NodeJS.Signals): void {
  process.stdout.write(`gateway: ${signal}, closing\n`);
  const force = setTimeout(() => process.exit(1), config.shutdownGraceMs);
  force.unref();
  server.close(() => {
    void egress.close().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
