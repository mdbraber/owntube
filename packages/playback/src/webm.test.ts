import { describe, expect, it } from "vitest";
import { clusterTimecode, parseCues, parseWebmInit } from "./webm.ts";

/** An EBML element: ID bytes as written, a 1-byte size (or 8-byte for large), then data. */
function el(id: number[], ...data: Uint8Array[]): Uint8Array {
  const body = concat(...data);
  const size =
    body.byteLength < 127
      ? [0x80 | body.byteLength]
      : [0x01, 0, 0, 0, ...u32(body.byteLength)];
  return concat(Uint8Array.from(id), Uint8Array.from(size), body);
}
const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const uint = (n: number) => Uint8Array.from(u32(n));
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

const ebmlHeader = el(
  [0x1a, 0x45, 0xdf, 0xa3],
  el(
    [0x42, 0x82],
    Uint8Array.from("webm", (c) => c.charCodeAt(0)),
  ),
);
const duration = new Uint8Array(8);
new DataView(duration.buffer).setFloat64(0, 9000);
const info = el(
  [0x15, 0x49, 0xa9, 0x66],
  el([0x2a, 0xd7, 0xb1], uint(1_000_000)),
  el([0x44, 0x89], duration),
);
// Segment with an unknown-like large size header; the init range ends after Info.
const segmentHeader = Uint8Array.from([
  0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]);
const initBytes = concat(ebmlHeader, segmentHeader, info);
const segmentDataStart = ebmlHeader.byteLength + segmentHeader.byteLength;

const cuePoint = (time: number, position: number) =>
  el(
    [0xbb],
    el([0xb3], uint(time)),
    el([0xb7], el([0xf7], Uint8Array.of(1)), el([0xf1], uint(position))),
  );
const cues = el(
  [0x1c, 0x53, 0xbb, 0x6b],
  cuePoint(0, 1000),
  cuePoint(4000, 5000),
  cuePoint(8000, 9000),
);

describe("parseWebmInit", () => {
  it("finds the Segment's data and the Info fields", () => {
    expect(parseWebmInit(initBytes)).toEqual({
      segmentDataStart,
      timecodeScale: 1_000_000,
      duration: 9000,
    });
  });
});

describe("parseCues", () => {
  it("turns cue points into one segment per cluster, the last ending at the file's end", () => {
    const segments = parseCues(cues, parseWebmInit(initBytes), 20_000);
    expect(segments).toEqual([
      {
        range: { start: segmentDataStart + 1000, end: segmentDataStart + 4999 },
        durationSec: 4,
        time: 0,
      },
      {
        range: { start: segmentDataStart + 5000, end: segmentDataStart + 8999 },
        durationSec: 4,
        time: 4000,
      },
      {
        range: { start: segmentDataStart + 9000, end: 19_999 },
        durationSec: 1,
        time: 8000,
      },
    ]);
  });

  it("rejects an index that is not Cues", () => {
    expect(() => parseCues(info, parseWebmInit(initBytes), 1)).toThrow(
      /not Cues/,
    );
  });
});

describe("clusterTimecode", () => {
  it("reads a cluster's Timecode", () => {
    const cluster = el(
      [0x1f, 0x43, 0xb6, 0x75],
      el([0xe7], uint(4000)),
      el([0xa3], new Uint8Array(10)),
    );
    expect(clusterTimecode(cluster)).toBe(4000);
    expect(clusterTimecode(cues)).toBeUndefined();
  });
});
