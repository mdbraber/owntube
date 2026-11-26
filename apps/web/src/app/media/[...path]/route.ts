import { gatewayConfig } from "@/server/gateway/config";

/**
 * `/media/*` belongs to the gateway (playback, images). A reverse proxy should
 * route it there directly (production does, in Caddy); this forwards it for a
 * setup without one, so the app works out of the box. Bytes stream through
 * untouched, ranges and all.
 */
export const dynamic = "force-dynamic";

const FORWARDED_REQUEST = ["range", "if-none-match", "if-modified-since"];
const FORWARDED_RESPONSE = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
];

async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = `${gatewayConfig().url}${url.pathname}${url.search}`;
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    signal: request.signal,
    redirect: "manual",
  });
  const out = new Headers();
  for (const name of FORWARDED_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const HEAD = forward;
