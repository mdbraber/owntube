/**
 * The example env files ship placeholders such as `change-me-in-production`;
 * some of them are long enough to pass a length check. Treat anything that
 * still reads like one as unset, so a copied example never runs with a
 * publicly known key.
 */
const PLACEHOLDER =
  /^(change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example|placeholder|secret$|changeme)/i;

export function isPlaceholderSecret(value: string | undefined): boolean {
  const v = value?.trim();
  if (!v) return true;
  return PLACEHOLDER.test(v);
}
