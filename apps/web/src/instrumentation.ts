import {
  invidiousPortCollidesWithNextApp,
  nextAppListenPort,
} from "@/lib/invidious-port-collision";

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const raw = process.env.INVIDIOUS_BASE_URL?.trim();
  if (!raw) {
    return;
  }

  if (!invidiousPortCollidesWithNextApp(raw)) {
    return;
  }

  const port = nextAppListenPort();
  console.warn(
    `\n\x1b[33m[OwnTube]\x1b[0m INVIDIOUS_BASE_URL uses the same loopback port as this Next.js process (PORT=${port}).\n` +
      "Server-side fetches will hit OwnTube (HTML / 404), not Invidious — search and watch will fail.\n" +
      "Fix: run OwnTube on port 3000 (default \x1b[1mpnpm dev\x1b[0m) and keep Invidious on 3001,\n" +
      "or map Invidious to another host port in Docker and update INVIDIOUS_BASE_URL.\n",
  );
}
