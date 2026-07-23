import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchWithTimeout routes media fetches through undici's own fetch (its
// dispatcher only works with the same undici build), so the global-fetch
// stub below would be bypassed — alias undici's fetch to the global one and
// neuter the Agent for tests.
vi.mock("undici", () => ({
  Agent: class {},
  fetch: (...args: unknown[]) =>
    (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
}));

import {
  GET,
  MEDIA_CHUNK_BYTES,
  parseByteRange,
} from "@/app/invidious/[[...path]]/route";

describe("parseByteRange", () => {
  it("parses bounded ranges", () => {
    expect(parseByteRange("bytes=0-1048575")).toEqual({
      start: 0,
      end: 1048575,
    });
  });
  it("parses open-ended ranges", () => {
    expect(parseByteRange("bytes=4096-")).toEqual({ start: 4096, end: null });
  });
  it("rejects suffix, multi-span, and malformed ranges", () => {
    expect(parseByteRange("bytes=-500")).toBeNull();
    expect(parseByteRange("bytes=0-1,5-9")).toBeNull();
    expect(parseByteRange("bytes=9-3")).toBeNull();
    expect(parseByteRange(null)).toBeNull();
  });
});

/** In-memory upstream that serves `file` with correct 206 Range semantics. */
function installUpstream(file: Uint8Array<ArrayBuffer>) {
  const rangesSeen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      if (!range) {
        return new Response(new Blob([file]), {
          status: 200,
          headers: { "content-type": "video/webm" },
        });
      }
      rangesSeen.push(range);
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m?.[1]) return new Response(null, { status: 416 });
      const start = Number(m[1]);
      const end = Math.min(
        m[2] ? Number(m[2]) : file.length - 1,
        file.length - 1,
      );
      return new Response(new Blob([file.slice(start, end + 1)]), {
        status: 206,
        headers: {
          "content-type": "video/webm",
          "content-range": `bytes ${start}-${end}/${file.length}`,
          "content-length": String(end - start + 1),
        },
      });
    }),
  );
  return rangesSeen;
}

function mediaRequest(range?: string): Request {
  return new Request("http://localhost:3000/invidious/videoplayback?id=x", {
    headers: range ? { range } : {},
  });
}

const routeContext = {
  params: Promise.resolve({ path: ["videoplayback"] }),
};

describe("chunked videoplayback proxying", () => {
  beforeEach(() => {
    vi.stubEnv("INVIDIOUS_BASE_URL", "http://invidious.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("splits a large bounded range into sequential ≤chunk upstream fetches", async () => {
    const size = Math.floor(MEDIA_CHUNK_BYTES * 2.5);
    const file = new Uint8Array(size).map((_, i) => i % 251);
    const ranges = installUpstream(file);

    const res = await GET(mediaRequest(`bytes=0-${size - 1}`), routeContext);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-${size - 1}/${size}`);
    expect(res.headers.get("content-length")).toBe(String(size));

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(size);
    // Buffer.compare: byte-equality on 5MB arrays (vitest deep-equal is O(n) with diffing and times out)
    expect(Buffer.compare(Buffer.from(body), Buffer.from(file))).toBe(0);
    expect(ranges).toEqual([
      `bytes=0-${MEDIA_CHUNK_BYTES - 1}`,
      `bytes=${MEDIA_CHUNK_BYTES}-${MEDIA_CHUNK_BYTES * 2 - 1}`,
      `bytes=${MEDIA_CHUNK_BYTES * 2}-${size - 1}`,
    ]);
  });

  it("serves an open-ended range chunked to the real end of file", async () => {
    const size = MEDIA_CHUNK_BYTES + 1000;
    const file = new Uint8Array(size).fill(7);
    const ranges = installUpstream(file);

    const res = await GET(mediaRequest("bytes=1000-"), routeContext);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 1000-${size - 1}/${size}`,
    );
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(size - 1000);
    expect(ranges[0]).toBe(`bytes=1000-${1000 + MEDIA_CHUNK_BYTES - 1}`);
  });

  it("streams a no-Range request as a chunked 200 with full length", async () => {
    const size = MEDIA_CHUNK_BYTES * 2;
    const file = new Uint8Array(size).fill(3);
    installUpstream(file);

    const res = await GET(mediaRequest(), routeContext);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(size);
  });

  it("passes small ranges through as a single upstream fetch", async () => {
    const file = new Uint8Array(4096).fill(9);
    const ranges = installUpstream(file);

    const res = await GET(mediaRequest("bytes=0-1023"), routeContext);
    expect(res.status).toBe(206);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(1024);
    expect(ranges).toEqual(["bytes=0-1023"]);
  });
});
