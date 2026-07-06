import {
  invidiousPortCollidesWithNextApp,
  nextAppListenPort,
} from "@/lib/invidious-port-collision";
import { hasSurroundingQuotes } from "@/lib/upstream-base-url";

/**
 * Warn about any env var whose value is wrapped in quotes. Environment values
 * are not a quoted format, so the quotes become part of the value (e.g.
 * `PIPED_BASE_URL="disabled"` is read as the literal string `"disabled"`, not
 * the disable keyword). Generic on purpose — not tied to any single var.
 */
function warnQuotedEnvValues() {
  const quoted = Object.entries(process.env)
    .filter(([, value]) => hasSurroundingQuotes(value))
    .map(([name]) => name);
  if (quoted.length === 0) {
    return;
  }
  console.warn(
    `\n\x1b[33m[OwnTube]\x1b[0m Environment variables wrapped in quotes: ${quoted.join(", ")}.\n` +
      "Env values are not a quoted format, so the quotes become part of the value\n" +
      '(e.g. PIPED_BASE_URL="disabled" is read as the literal string \'"disabled"\', not the disable keyword).\n' +
      "Write them unquoted, e.g. PIPED_BASE_URL=disabled.\n",
  );
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  warnQuotedEnvValues();

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
