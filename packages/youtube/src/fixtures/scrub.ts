import { isIP } from "node:net";
import type { Exchange } from "./exchange.ts";

/** Placeholders that replace our own address and visitor identity in stored fixtures. */
export const SCRUBBED_IPV4 = "203.0.113.7";
export const SCRUBBED_IPV6 = "2001:db8::7";
/** protobuf `{ 1: "SCRUBBEDVID" }`, the shape of a real visitor id. */
export const SCRUBBED_VISITOR_DATA = "CgtTQ1JVQkJFRFZJRA%3D%3D";

/** One canonical spelling per address, so `2a02:…:0:0:0:11`, `2a02:…::11` and `%3A`-encoded forms compare equal. */
export function canonicalIp(candidate: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(candidate);
  } catch {
    value = candidate;
  }
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6)
    return new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  return null;
}

/**
 * Finds what identifies us in a recording: the address YouTube saw (`ip=` and
 * `/ip/<addr>/` in googlevideo URLs, `remoteHost` in response contexts) and
 * every visitor-data token. These must never land in the repository.
 */
export function findSecrets(exchanges: readonly Exchange[]): {
  ips: Set<string>;
  visitorData: string[];
} {
  const text = JSON.stringify(exchanges);
  const ips = new Set<string>();
  const patterns = [
    /[?&]ip=([0-9A-Fa-f:.%]+)/g,
    /\/ip\/([0-9A-Fa-f:.%]+)\//g,
    /\\?"remoteHost\\?"\s*:\s*\\?"([^"\\]+)/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const ip = canonicalIp(m[1] as string);
      if (ip) ips.add(ip);
    }
  }
  const visitorData = new Set<string>();
  for (const m of text.matchAll(
    /\\?"(?:visitorData|VISITOR_DATA|visitor_data)\\?"\s*:\s*\\?"([^"\\]+)/g,
  )) {
    visitorData.add(m[1] as string);
  }
  return {
    ips,
    visitorData: [...visitorData].filter((v) => v !== SCRUBBED_VISITOR_DATA),
  };
}

// Anything that could spell an address: dotted quads, and colon (or %3A) separated hex groups.
const ADDRESS_LIKE =
  /(?:\d{1,3}\.){3}\d{1,3}|(?:[0-9A-Fa-f]{0,4}(?::|%3A|%3a)){2,7}[0-9A-Fa-f]{0,4}(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})?/g;

function scrubString(
  value: string,
  ips: ReadonlySet<string>,
  visitorData: readonly string[],
): string {
  let out = value.replace(ADDRESS_LIKE, (token) => {
    const ip = canonicalIp(token);
    if (!ip || !ips.has(ip)) return token;
    const placeholder = ip.includes(":") ? SCRUBBED_IPV6 : SCRUBBED_IPV4;
    return /%3a/i.test(token) ? encodeURIComponent(placeholder) : placeholder;
  });
  for (const vd of visitorData) {
    for (const v of encodings(vd))
      out = out.split(v).join(SCRUBBED_VISITOR_DATA);
  }
  return out;
}

/** Position of an IPv4 address as a whole token, so `1.2.3.4` is not found inside a version like `11.2.3.45`. */
function indexOfIpv4(text: string, ipv4: string): number {
  const escaped = ipv4.replaceAll(".", "\\.");
  return text.search(new RegExp(`(?<![\\d.])${escaped}(?!\\.?\\d)`));
}

/** `2a02:a45d:15fe::11` → `["2a02:a45d:15fe:", "2a02%3aa45d%3a15fe%3a"]` (lower case). */
function prefix48(ipv6: string): string[] {
  const [head = "", tail = ""] = ipv6.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [
    ...left,
    ...Array(8 - left.length - right.length).fill("0"),
    ...right,
  ].slice(0, 3);
  return [`${groups.join(":")}:`, `${groups.join("%3a")}%3a`];
}

function encodings(value: string): string[] {
  const out = new Set([value, encodeURIComponent(value)]);
  try {
    out.add(decodeURIComponent(value));
  } catch {
    // not URI-encoded
  }
  // Longest first, so an encoded form is not half-replaced by its decoded prefix.
  return [...out]
    .filter((v) => v.length > 0)
    .sort((a, b) => b.length - a.length);
}

function walk(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, walk(v, fn)]),
    );
  }
  return value;
}

/** Replaces our address (in every spelling) and visitor data with placeholders, then proves nothing survived. */
export function scrubExchanges(exchanges: readonly Exchange[]): Exchange[] {
  const { ips, visitorData } = findSecrets(exchanges);
  const scrubbed = exchanges.map(
    (e) => walk(e, (s) => scrubString(s, ips, visitorData)) as Exchange,
  );
  assertScrubbed(scrubbed, ips, visitorData);
  return scrubbed;
}

/** Throws when any secret survived, in any spelling or encoding. */
export function assertScrubbed(
  exchanges: readonly Exchange[],
  ips: ReadonlySet<string>,
  visitorData: readonly string[],
): void {
  const text = JSON.stringify(exchanges);
  for (const token of text.match(ADDRESS_LIKE) ?? []) {
    const ip = canonicalIp(token);
    if (ip && ips.has(ip)) throw new Error("scrub: an address survived");
  }
  // Independent of the tokenizer above: no IPv4 as a substring, and not even the
  // /48 prefix of an IPv6 address in any separator or case.
  const lower = text.toLowerCase();
  for (const ip of ips) {
    const needles = ip.includes(":") ? prefix48(ip) : [ip];
    for (const needle of needles) {
      const at = ip.includes(":")
        ? lower.indexOf(needle)
        : indexOfIpv4(lower, needle);
      if (at < 0) continue;
      // Say where, without printing the address itself.
      const before = text.slice(Math.max(0, at - 40), at);
      const after = text.slice(at + needle.length, at + needle.length + 20);
      throw new Error(`scrub: an address survived: …${before}<addr>${after}…`);
    }
  }
  for (const vd of visitorData) {
    for (const v of encodings(vd))
      if (text.includes(v)) throw new Error("scrub: visitor data survived");
  }
}
