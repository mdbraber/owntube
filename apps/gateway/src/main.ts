import { serve } from "@hono/node-server";
import { createEgress } from "@owntube/youtube/egress";
import { SessionPool } from "@owntube/youtube/session";
import { YouTube } from "@owntube/youtube/youtube";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { PlaybackSessions } from "./media/sessions.ts";

const config = loadConfig();
const egress = createEgress({
  ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
});
const sessions = new PlaybackSessions({
  youtube: new YouTube(new SessionPool({ egress })),
});
const app = createApp({ sessions, signingKey: config.signingKey });
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
