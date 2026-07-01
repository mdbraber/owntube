/**
 * Normalize YouTube channel ids stored or imported from Takeout / CSV glitches:
 * - `ChannelNameUCxxxx` (title pasted with id)
 * - `UCUCxxxx` or `UCxxxxUCxxxx` (doubled prefix / duplicated id)
 */

const UC_TAIL = /^UC[A-Za-z0-9_-]{10,30}/;

function stripExactDoubledString(s: string): string {
  let out = s;
  for (;;) {
    if (out.length < 20 || out.length % 2 !== 0) break;
    const h = out.length / 2;
    if (out.slice(0, h) === out.slice(h)) out = out.slice(0, h);
    else break;
  }
  return out;
}

function stripDoubledUcPrefix(s: string): string {
  let out = s;
  while (out.startsWith("UCUC") && out.length > 12) {
    out = out.slice(2);
  }
  return out;
}

/** Alternate doubled-`UC` prefix and duplicated full id until stable. */
function canonicalizeUcGlue(s: string): string {
  let prev = "";
  let out = s;
  while (out !== prev) {
    prev = out;
    out = stripExactDoubledString(out);
    out = stripDoubledUcPrefix(out);
  }
  return out;
}

function extractLongestUcRun(s: string): string | null {
  let best: string | null = null;
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf("UC", i);
    if (j === -1) break;
    const tail = s.slice(j);
    const m = tail.match(UC_TAIL);
    if (m) {
      const cand = m[0];
      if (cand.length >= 12 && (!best || cand.length > best.length)) {
        best = cand;
      }
    }
    i = j + 2;
  }
  return best;
}

/**
 * Returns a plausible channel id for Invidious/Piped, or the trimmed input if
 * nothing looks like a `UC…` id (e.g. `@handle` kept as-is).
 */
export function normalizeYoutubeChannelId(raw: string): string {
  const s0 = raw.trim().replace(/^"+|"+$/g, "");
  if (!s0) return s0;

  const s = canonicalizeUcGlue(s0);

  if (/^UC[A-Za-z0-9_-]{10,64}$/.test(s)) {
    return s;
  }

  const extracted = extractLongestUcRun(s);
  if (!extracted) {
    return s0;
  }
  return canonicalizeUcGlue(extracted);
}

export function looksLikeYoutubeChannelId(s: string): boolean {
  return /^UC[A-Za-z0-9_-]{10,64}$/.test(s);
}
