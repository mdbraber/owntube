/**
 * One HTTP request/response pair between youtubei.js and YouTube, as stored in
 * the fixture corpus. Only what a replay needs is kept: no request headers (they
 * carry cookies and visitor ids), no response headers but the content type.
 */
export interface Exchange {
  method: string;
  url: string;
  requestBody: unknown;
  status: number;
  contentType: string | null;
  responseBody: unknown;
}

export interface FixtureFile {
  /** Corpus entry id, e.g. `video-hdr`. */
  id: string;
  recordedAt: string;
  youtubeiVersion: string;
  /** What the recording resolved the entry to (a discovered video id, …). */
  resolved: Record<string, string>;
  exchanges: Exchange[];
}

/** Parses a body as JSON when it is JSON, else keeps the text. */
export function decodeBody(text: string, contentType: string | null): unknown {
  if (text === "") return null;
  if (contentType?.includes("json") || /^[[{]/.test(text.trimStart())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function encodeBody(body: unknown): string {
  if (body === null || body === undefined) return "";
  return typeof body === "string" ? body : JSON.stringify(body);
}

/**
 * The identity of a request for replay: method, path and query (without the
 * volatile `key`/`prettyPrint`/`alt`/`t` params) and the request body without
 * its `context`, which carries client versions and visitor data.
 */
export function exchangeKey(
  method: string,
  url: string,
  requestBody: unknown,
): string {
  const u = new URL(url);
  for (const volatile of ["key", "prettyPrint", "alt", "t", "$fields"])
    u.searchParams.delete(volatile);
  u.searchParams.sort();
  let body = requestBody;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const { context: _context, ...rest } = body as Record<string, unknown>;
    body = rest;
  }
  return `${method.toUpperCase()} ${u.host}${u.pathname}${u.search} ${stableStringify(body)}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
