import { describe, expect, it } from "vitest";
import { chunks, parseRange, streamSpan } from "./upstream.ts";

describe("parseRange", () => {
  it("reads closed, open and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=990-5000", 1000)).toEqual({
      start: 990,
      end: 999,
    });
  });

  it("covers the whole file without a header", () => {
    expect(parseRange(undefined, 1000)).toEqual({ start: 0, end: 999 });
  });

  it("rejects what it cannot satisfy", () => {
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=5-1", 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });
});

describe("chunks", () => {
  it("splits a span into pieces of at most the given size", () => {
    expect(chunks({ start: 10, end: 34 }, 10)).toEqual([
      { start: 10, end: 19 },
      { start: 20, end: 29 },
      { start: 30, end: 34 },
    ]);
  });
});

describe("streamSpan", () => {
  const file = new Uint8Array(100).map((_, i) => i);
  const fetched: string[] = [];
  const source = {
    fetchPiece: async (piece: { start: number; end: number }) => {
      fetched.push(`${piece.start}-${piece.end}`);
      return new Response(file.slice(piece.start, piece.end + 1))
        .body as ReadableStream<Uint8Array>;
    },
  };

  it("returns exactly the requested bytes", async () => {
    const body = streamSpan(
      source,
      { start: 5, end: 94 },
      new AbortController().signal,
    );
    expect([...new Uint8Array(await new Response(body).arrayBuffer())]).toEqual(
      [...file.slice(5, 95)],
    );
  });

  it("fetches a piece only when the reader gets to it", async () => {
    fetched.length = 0;
    const reader = streamSpan(
      source,
      { start: 0, end: 99 },
      new AbortController().signal,
    ).getReader();
    await reader.read();
    expect(fetched).toHaveLength(1);
    await reader.cancel();
  });
});
