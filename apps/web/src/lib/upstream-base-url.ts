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
