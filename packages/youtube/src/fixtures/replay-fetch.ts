import {
  decodeBody,
  type Exchange,
  encodeBody,
  exchangeKey,
} from "./exchange.ts";

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * A `fetch` that answers from recorded exchanges and never touches the network.
 * Requests are matched by {@link exchangeKey}; repeated identical requests get
 * the recordings in order (the last one repeats). Unknown requests throw, so a
 * test fails loudly instead of silently going online.
 */
export function createReplayFetch(
  exchanges: readonly Exchange[],
): typeof fetch {
  const byKey = new Map<string, Exchange[]>();
  for (const exchange of exchanges) {
    const key = exchangeKey(
      exchange.method,
      exchange.url,
      exchange.requestBody,
    );
    byKey.set(key, [...(byKey.get(key) ?? []), exchange]);
  }
  const served = new Map<string, number>();

  return async (input, init) => {
    const request = new Request(input, init);
    const text = request.body ? await request.clone().text() : "";
    const key = exchangeKey(
      request.method,
      request.url,
      decodeBody(text, request.headers.get("content-type")),
    );
    const candidates = byKey.get(key);
    if (!candidates || candidates.length === 0) {
      throw new Error(`replay: no recorded exchange for ${key.slice(0, 300)}`);
    }
    const index = served.get(key) ?? 0;
    served.set(key, index + 1);
    const exchange = candidates[
      Math.min(index, candidates.length - 1)
    ] as Exchange;
    const headers = exchange.contentType
      ? { "content-type": exchange.contentType }
      : undefined;
    const body = NULL_BODY_STATUSES.has(exchange.status)
      ? null
      : encodeBody(exchange.responseBody);
    return new Response(body, { status: exchange.status, headers });
  };
}
