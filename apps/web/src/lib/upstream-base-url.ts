/**
 * Strip one layer of matching surrounding quotes. Docker Compose `env_file` and
 * `${VAR}` interpolation keep quotes literally, so `PIPED_BASE_URL="disabled"`
 * arrives as the value `"disabled"` (quotes included) — without this, that reads
 * as a base URL rather than the disable keyword.
 */
function stripSurroundingQuotes(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    if ((first === '"' || first === "'") && v[v.length - 1] === first) {
      return v.slice(1, -1).trim();
    }
  }
  return v;
}

/** Values that mean “do not use this upstream” in `.env` or user settings. */
export function isUpstreamDisabled(value: string | undefined | null): boolean {
  const v = stripSurroundingQuotes(value ?? "").toLowerCase();
  if (!v) return false;
  return (
    v === "disabled" ||
    v === "disable" ||
    v === "off" ||
    v === "false" ||
    v === "none" ||
    v === "no"
  );
}

/** Trim trailing slashes; return empty when unset or explicitly disabled. */
export function normalizeUpstreamBaseUrl(
  value: string | undefined | null,
): string {
  const raw = stripSurroundingQuotes(value ?? "");
  if (!raw || isUpstreamDisabled(raw)) return "";
  return raw.replace(/\/+$/, "");
}
