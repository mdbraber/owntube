import { decodeBody, type Exchange } from "./exchange.ts";

export interface RecordingFetch {
  fetch: typeof fetch;
  exchanges: Exchange[];
}

/** Wraps `fetch` so every exchange is kept, unmodified, for later scrubbing and storage. */
export function createRecordingFetch(
  inner: typeof fetch = fetch,
): RecordingFetch {
  const exchanges: Exchange[] = [];
  const recording: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const requestText = request.body ? await request.clone().text() : "";
    const response = await inner(request);
    const contentType = response.headers.get("content-type");
    const responseText = await response.clone().text();
    exchanges.push({
      method: request.method,
      url: request.url,
      requestBody: decodeBody(requestText, request.headers.get("content-type")),
      status: response.status,
      contentType,
      responseBody: decodeBody(responseText, contentType),
    });
    return response;
  };
  return { fetch: recording, exchanges };
}
