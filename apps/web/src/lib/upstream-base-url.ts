/** Values that mean “do not use this upstream” in `.env` or user settings. */
export function isUpstreamDisabled(value: string | undefined | null): boolean {
  const v = value?.trim().toLowerCase() ?? "";
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
  const raw = value?.trim() ?? "";
  if (!raw || isUpstreamDisabled(raw)) return "";
  return raw.replace(/\/+$/, "");
}

/**
 * True when a value is wrapped in matching surrounding quotes. Environment
 * variables are not a quoted format, so this signals a `.env` mistake (e.g.
 * `PIPED_BASE_URL="disabled"`) — the value should be written unquoted. Callers
 * warn on this rather than silently stripping it.
 */
export function hasSurroundingQuotes(
  value: string | undefined | null,
): boolean {
  const v = value?.trim() ?? "";
  if (v.length < 2) return false;
  const q = v[0];
  return (q === '"' || q === "'") && v[v.length - 1] === q;
}
