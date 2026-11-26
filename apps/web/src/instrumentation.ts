function hasSurroundingQuotes(value: string | undefined): boolean {
  const v = value?.trim();
  if (!v || v.length < 2) return false;
  return (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  );
}

/**
 * Warn about any env var whose value is wrapped in quotes. Environment values
 * are not a quoted format, so the quotes become part of the value (e.g.
 * `GATEWAY_URL="http://gateway:8080"` is read with the quotes). Generic on purpose — not tied to any single var.
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
      "Env values are not a quoted format, so the quotes become part of the value.\n" +
      "Write them unquoted, e.g. GATEWAY_URL=http://gateway:8080.\n",
  );
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  warnQuotedEnvValues();

  // Imported lazily: it pulls in the database and must stay out of the edge bundle.
  if (process.env.OWNTUBE_PUBLISH_TARGET?.trim()) {
    const { startFeedPublisher } = await import("@/server/remote/publish-loop");
    startFeedPublisher();
  }

  const { getDb } = await import("@/server/db/client");
  const { startCacheWarmer } = await import("@/server/warm-cache/job");
  startCacheWarmer(getDb());
}
