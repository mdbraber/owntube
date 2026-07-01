import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import zlib from "node:zlib";

const MAX_REDIRECTS = 5;

const UA = "OwnTube/0.1 (+https://github.com/iv-org/invidious API client)";

/**
 * Keep-alive agents so repeated Piped/Invidious API calls reuse TCP+TLS
 * connections instead of paying a fresh handshake (~100-300ms) per request.
 * The whole feed/shorts/search/detail path funnels through here, so pooling
 * is the single biggest latency win for upstream JSON fetches.
 */
const AGENT_OPTS = {
  keepAlive: true,
  keepAliveMsecs: 15_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 30_000,
};
const httpAgent = new http.Agent(AGENT_OPTS);
const httpsAgent = new https.Agent(AGENT_OPTS);

function decodeResponseBody(
  buf: Buffer,
  contentEncoding: string | undefined,
): string {
  const enc = String(contentEncoding ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  try {
    if (enc === "gzip" || enc === "x-gzip") {
      return zlib.gunzipSync(buf).toString("utf8");
    }
    if (enc === "deflate" || enc === "x-deflate") {
      return zlib.inflateSync(buf).toString("utf8");
    }
    if (enc === "br") {
      return zlib.brotliDecompressSync(buf).toString("utf8");
    }
  } catch {
    // Fall through: treat as raw UTF-8 (e.g. mislabeled encoding).
  }
  return buf.toString("utf8");
}

export type UpstreamGetResult = {
  status: number;
  ok: boolean;
  text: string;
};

/**
 * Plain Node HTTP GET (no Next.js `fetch` memoization / shared Response body).
 * Used for Piped / Invidious JSON APIs where large bodies must be read reliably.
 */
export function upstreamGetText(
  urlString: string,
  timeoutMs: number,
): Promise<UpstreamGetResult> {
  return new Promise((resolve, reject) => {
    const run = (currentUrl: string, redirectCount: number) => {
      if (redirectCount > MAX_REDIRECTS) {
        reject(new Error(`too many redirects (${MAX_REDIRECTS})`));
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch (e) {
        reject(e);
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        reject(new Error(`unsupported URL protocol: ${parsed.protocol}`));
        return;
      }

      const isHttps = parsed.protocol === "https:";
      const lib = isHttps ? https : http;
      const req = lib.request(
        parsed,
        {
          method: "GET",
          agent: isHttps ? httpsAgent : httpAgent,
          headers: {
            Accept: "application/json",
            // The decode path below already handles gzip/deflate/br; request it
            // so large feed/search JSON transfers compressed instead of raw.
            "Accept-Encoding": "gzip, deflate, br",
            "User-Agent": UA,
          },
        },
        (res) => {
          const code = res.statusCode ?? 0;
          const loc = res.headers.location;
          if (code >= 300 && code < 400 && loc) {
            res.resume();
            const nextUrl = new URL(loc, parsed).toString();
            run(nextUrl, redirectCount + 1);
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const text = decodeResponseBody(
              buf,
              res.headers["content-encoding"],
            );
            resolve({
              status: code,
              ok: code >= 200 && code < 300,
              text,
            });
          });
          res.on("error", reject);
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error("upstream timeout"));
      });
      req.on("error", reject);
      req.end();
    };

    run(urlString, 0);
  });
}
