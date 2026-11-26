import { serve } from "@hono/node-server";
import { Catalog } from "@owntube/youtube/catalog";
import { WEB } from "@owntube/youtube/clients";
import { createEgress } from "@owntube/youtube/egress";
import { BrowserPoTokenMinter } from "@owntube/youtube/potoken";
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
const youtube = new YouTube(new SessionPool({ egress }));
const catalog = new Catalog({
  yt: () => youtube.innertube(),
  // Our own VISIONOS identity; a bot check here counts against the session like any other.
  player: (videoId) => youtube.player(videoId),
});
const poTokens = config.poBrowser
  ? new BrowserPoTokenMinter({
      executablePath: config.poBrowser,
      fetch: egress.fetch(),
      userAgent: WEB.userAgent,
    })
  : undefined;
const sessions = new PlaybackSessions({
  ...(poTokens ? { poTokens } : {}),
  log: (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`),
  preferSabr: config.transport === "sabr",
  progressiveStore: diskProgressiveStore(`${config.cacheDir}/progressive`),
  youtube,
});
const imageCacheDir = `${config.cacheDir}/images`;
const app = createApp({
  sessions,
  catalog,
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
    void Promise.all([egress.close(), poTokens?.close()]).finally(() =>
      process.exit(0),
    );
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
