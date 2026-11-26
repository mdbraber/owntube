import type { Segment } from "@owntube/playback/sidx";
import { describe, expect, it } from "vitest";
import {
  AttestationRequired,
  mfhdSequence,
  SabrTrack,
  type StreamOpener,
} from "./sabr.ts";

/**
 * A synthetic track file: a 100-byte prefix (stands for ftyp+moov+sidx), then
 * fragments that start with a moof/mfhd carrying their sequence number, each
 * 1 s long and filled with a byte unique to it.
 */
const PREFIX = 100;
const sizes = [300, 200, 400, 250, 350];
const segments: Segment[] = [];
let at = PREFIX;
for (const size of sizes) {
  segments.push({ range: { start: at, end: at + size - 1 }, durationSec: 1 });
  at += size;
}
function fragmentBytes(index: number): Uint8Array {
  const bytes = new Uint8Array(sizes[index] as number).fill(0x40 + index);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 24);
  bytes.set([0x6d, 0x6f, 0x6f, 0x66], 4); // moof
  v.setUint32(8, 16);
  bytes.set([0x6d, 0x66, 0x68, 0x64], 12); // mfhd
  v.setUint32(20, index + 1);
  return bytes;
}
const file = new Uint8Array(at);
file.fill(0x11, 0, PREFIX);
for (const [i, s] of segments.entries())
  file.set(fragmentBytes(i), s.range.start);

/** Streams the prefix, then fragments from the one containing `startMs` (or `early` ones before it), in small chunks. */
function opener(early = 0) {
  const opened: number[] = [];
  const open: StreamOpener = (startMs) => {
    opened.push(startMs);
    const first = Math.max(0, Math.floor(startMs / 1000) - early);
    const body = new Uint8Array([
      ...file.subarray(0, PREFIX),
      ...file.subarray(segments[first]?.range.start ?? at),
    ]);
    let o = 0;
    const stream = new ReadableStream<ArrayBufferView>({
      pull(controller) {
        if (o >= body.byteLength) return controller.close();
        controller.enqueue(body.subarray(o, o + 64));
        o += 64;
      },
    });
    return { stream, close: async () => {} };
  };
  return { open, opened };
}

function track(
  open: StreamOpener,
  segmentsOf: () => Promise<readonly Segment[]> = async () => segments,
) {
  return new SabrTrack(
    {
      kind: "video",
      container: "mp4",
      itag: 136,
      companionAudioItag: 140,
      segments: segmentsOf,
      indexEnd: PREFIX - 1,
    },
    open,
  );
}

const expected = (start: number, end: number) => file.subarray(start, end + 1);

describe("SabrTrack", () => {
  it("serves the prefix and any range of fragments as the file's bytes", async () => {
    const t = track(opener().open);
    expect(await t.read({ start: 0, end: 99 })).toEqual(expected(0, 99));
    expect(await t.read({ start: 50, end: 450 })).toEqual(expected(50, 450));
    expect(
      await t.read({ start: segments[3]?.range.start ?? 0, end: at - 1 }),
    ).toEqual(expected(segments[3]?.range.start ?? 0, at - 1));
  });

  it("keeps one pull going while reads are sequential", async () => {
    const { open, opened } = opener();
    const t = track(open);
    for (const s of segments)
      expect(await t.read(s.range)).toEqual(
        expected(s.range.start, s.range.end),
      );
    expect(opened).toEqual([0]);
  });

  it("starts a new pull at the right time on a jump", async () => {
    const { open, opened } = opener();
    const t = track(open);
    expect(await t.read(segments[3]?.range ?? { start: 0, end: 0 })).toEqual(
      expected(segments[3]?.range.start ?? 0, segments[3]?.range.end ?? 0),
    );
    expect(await t.read(segments[1]?.range ?? { start: 0, end: 0 })).toEqual(
      expected(segments[1]?.range.start ?? 0, segments[1]?.range.end ?? 0),
    );
    expect(opened).toEqual([3000, 1000]);
  });

  it("skips fragments a pull delivers before the one asked for", async () => {
    const t = track(opener(2).open);
    const s = segments[4]?.range ?? { start: 0, end: 0 };
    expect(await t.read(s)).toEqual(expected(s.start, s.end));
  });

  it("does not deadlock when the fragment list is itself read through the track", async () => {
    let t: SabrTrack | undefined;
    const viaTrack = async () => {
      await t?.read({ start: 0, end: PREFIX - 1 }); // the index lives in the prefix
      return segments;
    };
    t = track(opener().open, viaTrack);
    const s = segments[2]?.range ?? { start: 0, end: 0 };
    expect(await t.read(s)).toEqual(expected(s.start, s.end));
  });
});

describe("mfhdSequence", () => {
  it("reads a moof's sequence number and rejects anything else", () => {
    expect(mfhdSequence(fragmentBytes(4))).toBe(5);
    expect(() => mfhdSequence(new Uint8Array(24))).toThrow(/moof/);
  });
});

describe("SabrTrack over WebM", () => {
  // Clusters identified by Timecode (= their cue time), not by moof sequence.
  const clusterSizes = [120, 90, 150];
  const clusters: Segment[] = [];
  let pos = PREFIX;
  for (const [i, size] of clusterSizes.entries()) {
    clusters.push({
      range: { start: pos, end: pos + size - 1 },
      durationSec: 4,
      time: i * 4000,
    });
    pos += size;
  }
  const webm = new Uint8Array(pos).fill(0x22, 0, PREFIX);
  for (const [i, c] of clusters.entries()) {
    const bytes = new Uint8Array(clusterSizes[i] as number).fill(0x60 + i);
    // Cluster ID, 1-byte size, Timecode element (ID 0xE7, 4-byte uint).
    bytes.set(
      [
        0x1f,
        0x43,
        0xb6,
        0x75,
        0x80 | 6,
        0xe7,
        0x84,
        0,
        0,
        ((i * 4000) >> 8) & 0xff,
        (i * 4000) & 0xff,
      ],
      0,
    );
    webm.set(bytes, c.range.start);
  }
  const open: StreamOpener = (startMs) => {
    const first = clusters.findIndex((c) => (c.time ?? 0) >= startMs);
    const body = new Uint8Array([
      ...webm.subarray(0, PREFIX),
      ...webm.subarray(clusters[first]?.range.start ?? pos),
    ]);
    return {
      stream: new Response(body).body as ReadableStream<ArrayBufferView>,
      close: async () => {},
    };
  };
  const t = new SabrTrack(
    {
      kind: "video",
      container: "webm",
      itag: 247,
      companionAudioItag: 251,
      segments: async () => clusters,
      indexEnd: PREFIX - 1,
    },
    open,
  );

  it("reads clusters by range, recognised by their Timecode", async () => {
    for (const c of [clusters[2], clusters[0], clusters[1]]) {
      const r = c?.range ?? { start: 0, end: 0 };
      expect(await t.read(r)).toEqual(webm.subarray(r.start, r.end + 1));
    }
  });
});

describe("SabrTrack when a pull fails", () => {
  it("rejects the read with the pull's error and starts a new pull next time", async () => {
    let attempt = 0;
    const open: StreamOpener = (startMs) => {
      attempt++;
      if (attempt === 1) {
        // Prefix arrives, then the server rejects attestation mid-stream.
        const stream = new ReadableStream<ArrayBufferView>({
          start(controller) {
            controller.enqueue(file.subarray(0, PREFIX));
          },
          pull(controller) {
            controller.error(new AttestationRequired());
          },
        });
        return { stream, close: async () => {} };
      }
      return opener().open(startMs);
    };
    const t = track(open);
    const s = segments[1]?.range ?? { start: 0, end: 0 };
    await expect(t.read(s)).rejects.toBeInstanceOf(AttestationRequired);
    expect(await t.read(s)).toEqual(expected(s.start, s.end));
    expect(attempt).toBe(2);
  });
});
