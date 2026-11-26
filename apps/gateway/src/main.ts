import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const server = serve(
  { fetch: createApp().fetch, hostname: config.host, port: config.port },
  (info) => {
    process.stdout.write(`gateway listening on ${info.address}:${info.port}\n`);
  },
);

function shutdown(signal: NodeJS.Signals): void {
  process.stdout.write(`gateway: ${signal}, closing\n`);
  const force = setTimeout(() => process.exit(1), config.shutdownGraceMs);
  force.unref();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
