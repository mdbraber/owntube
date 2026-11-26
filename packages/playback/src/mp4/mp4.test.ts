import { describe, expect, it } from "vitest";
import {
  box,
  children,
  find,
  findAll,
  fullBox,
  view,
  Writer,
} from "./boxes.ts";
import { type Fragment, parseFragment, parseInit } from "./fragmented.ts";
import {
  buildProgressive,
  type ProgressiveFile,
  partsOf,
} from "./progressive.ts";

// --- a tiny fragmented MP4 writer, for building test inputs ---------------

function init(
  kind: "video" | "audio",
  timescale: number,
  edit?: { duration: number; mediaTime: number },
): Uint8Array {
  const handler = kind === "video" ? "vide" : "soun";
  const tkhd = fullBox(
    "tkhd",
    0,
    3,
    new Writer()
      .zeros(72)
      .u32(kind === "video" ? 1280 << 16 : 0)
      .u32(kind === "video" ? 720 << 16 : 0)
      .done(),
  );
  const mdhd = fullBox(
    "mdhd",
    0,
    0,
    new Writer().u32(0).u32(0).u32(timescale).u32(0).u16(0x55c4).u16(0).done(),
  );
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    new Writer().u32(0).ascii(handler).zeros(12).ascii("x\0").done(),
  );
  const media =
    kind === "video"
      ? fullBox("vmhd", 0, 1, new Writer().zeros(8).done())
      : fullBox("smhd", 0, 0, new Writer().zeros(4).done());
  const dinf = box(
    "dinf",
    fullBox("dref", 0, 0, new Writer().u32(1).done(), fullBox("url ", 0, 1)),
  );
  const stsd = fullBox(
    "stsd",
    0,
    0,
    new Writer().u32(1).done(),
    box(kind === "video" ? "avc1" : "mp4a", new Uint8Array(8)),
  );
  const stbl = box("stbl", stsd);
  const edts = edit
    ? [
        box(
          "edts",
          fullBox(
            "elst",
            0,
            0,
            new Writer()
              .u32(1)
              .u32(edit.duration)
              .i32(edit.mediaTime)
              .u32(0x10000)
              .done(),
          ),
        ),
      ]
    : [];
  const trak = box(
    "trak",
    tkhd,
    ...edts,
    box("mdia", mdhd, hdlr, box("minf", media, dinf, stbl)),
  );
  const mvhd = fullBox(
    "mvhd",
    0,
    0,
    new Writer().u32(0).u32(0).u32(1000).u32(0).zeros(80).done(),
  );
  const mvex = box(
    "mvex",
    fullBox(
      "trex",
      0,
      0,
      new Writer().u32(1).u32(1).u32(0).u32(0).u32(0).done(),
    ),
  );
  return new Writer()
    .bytes(box("ftyp", new Writer().ascii("iso5").u32(0).done()))
    .bytes(box("moov", mvhd, trak, mvex))
    .done();
}

interface TestSample {
  duration: number;
  bytes: Uint8Array;
  sync: boolean;
  cto: number;
}

/** moof + mdat for `samples`, with per-sample duration, size, flags and (signed) composition offsets. */
function fragment(
  sequence: number,
  decodeTime: number,
  samples: TestSample[],
): Uint8Array {
  const trunBody = (dataOffset: number) => {
    const w = new Writer().u32(samples.length).i32(dataOffset);
    for (const s of samples)
      w.u32(s.duration)
        .u32(s.bytes.byteLength)
        .u32(s.sync ? 0 : 0x10000)
        .i32(s.cto);
    return w.done();
  };
  const build = (dataOffset: number) =>
    box(
      "moof",
      fullBox("mfhd", 0, 0, new Writer().u32(sequence).done()),
      box(
        "traf",
        fullBox("tfhd", 0, 0x20000, new Writer().u32(1).done()),
        fullBox("tfdt", 1, 0, new Writer().u64(decodeTime).done()),
        fullBox(
          "trun",
          1,
          0x1 | 0x100 | 0x200 | 0x400 | 0x800,
          trunBody(dataOffset),
        ),
      ),
    );
  const moofSize = build(0).byteLength;
  const payload = new Writer();
  for (const s of samples) payload.bytes(s.bytes);
  return new Writer()
    .bytes(build(moofSize + 8))
    .bytes(box("mdat", payload.done()))
    .done();
}

/** A file of init + fragments; returns its bytes and each fragment's offset. */
function file(
  initBytes: Uint8Array,
  fragments: Uint8Array[],
): { bytes: Uint8Array; offsets: number[] } {
  const w = new Writer().bytes(initBytes);
  const offsets: number[] = [];
  for (const f of fragments) {
    offsets.push(w.length);
    w.bytes(f);
  }
  return { bytes: w.done(), offsets };
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing");
  return value;
}

const fill = (value: number, length: number) =>
  new Uint8Array(length).fill(value);

// Video: 30 fps at timescale 30000 (1001 per frame), 3 fragments of 3 frames, B-frame style offsets.
const videoSamples = (f: number): TestSample[] =>
  [0, 1, 2].map((i) => ({
    duration: 1001,
    bytes: fill(16 + f * 3 + i, 100 + 10 * i),
    sync: i === 0,
    cto: i === 1 ? -1001 : 2002,
  }));
const video = file(
  init("video", 30000, { duration: 300, mediaTime: 2002 }),
  [0, 1, 2].map((f) => fragment(f + 1, f * 3003, videoSamples(f))),
);
// Audio: 2 fragments of 4 frames at 44100 Hz, AAC frame size 1024.
const audioSamples = (f: number): TestSample[] =>
  [0, 1, 2, 3].map((i) => ({
    duration: 1024,
    bytes: fill(128 + f * 4 + i, 50),
    sync: true,
    cto: 0,
  }));
const audio = file(
  init("audio", 44100),
  [0, 1].map((f) => fragment(f + 1, f * 4096, audioSamples(f))),
);

function fragmentsOf(source: {
  bytes: Uint8Array;
  offsets: number[];
}): Fragment[] {
  const trackInit = parseInit(source.bytes);
  return source.offsets.map((o) =>
    parseFragment(source.bytes.subarray(o), o, trackInit),
  );
}

/** The progressive file's bytes, assembled from its parts the way the gateway does. */
function assemble(progressive: ProgressiveFile): Uint8Array {
  const sources: Record<string, Uint8Array> = {
    v: video.bytes,
    a: audio.bytes,
  };
  const w = new Writer();
  for (const part of partsOf(progressive, {
    start: 0,
    end: progressive.size - 1,
  })) {
    w.bytes(
      "bytes" in part
        ? part.bytes
        : (sources[part.source] as Uint8Array).subarray(
            part.range.start,
            part.range.end + 1,
          ),
    );
  }
  return w.done();
}

/** Decodes a regular MP4's sample tables into per-sample bytes, durations and sync flags. */
function readSamples(mp4: Uint8Array, trackIndex: number) {
  const v = view(mp4);
  const trak = must(
    findAll(mp4, "trak", must(find(mp4, ["moov"])))[trackIndex],
  );
  const stbl = must(find(mp4, ["mdia", "minf", "stbl"], trak));
  const u32s = (type: string, skip: number) => {
    const b = find(mp4, [type], stbl);
    if (!b) return undefined;
    const n = v.getUint32(b.content + 4 + skip);
    return Array.from(
      {
        length:
          n *
          (type === "stts" || type === "ctts" ? 2 : type === "stsc" ? 3 : 1),
      },
      (_, i) => v.getUint32(b.content + 8 + skip + i * 4),
    );
  };
  const sizes = must(u32s("stsz", 4));
  const offsets = must(u32s("stco", 0));
  const stsc = must(u32s("stsc", 0));
  const stts = must(u32s("stts", 0));
  const stss = u32s("stss", 0);
  const durations = stts.flatMap((x, i) =>
    i % 2 ? [] : Array(x).fill(stts[i + 1]),
  );
  const out: Array<{ bytes: Uint8Array; duration: number; sync: boolean }> = [];
  let sample = 0;
  for (let chunk = 0; chunk < offsets.length; chunk++) {
    let entry = 0;
    for (let e = 0; e < stsc.length / 3; e++)
      if ((stsc[e * 3] as number) <= chunk + 1) entry = e;
    let at = offsets[chunk] as number;
    for (let k = 0; k < (stsc[entry * 3 + 1] as number); k++) {
      const size = sizes[sample] as number;
      out.push({
        bytes: mp4.subarray(at, at + size),
        duration: durations[sample],
        sync: stss ? stss.includes(sample + 1) : true,
      });
      at += size;
      sample++;
    }
  }
  return out;
}

describe("parseInit", () => {
  it("reads the track's kind, timescale and edit list", () => {
    const t = parseInit(video.bytes);
    expect(t).toMatchObject({
      kind: "video",
      timescale: 30000,
      width: 1280 << 16,
      height: 720 << 16,
    });
    expect(t.edits).toEqual([{ durationSec: 0.3, mediaTime: 2002 }]);
    expect(parseInit(audio.bytes)).toMatchObject({
      kind: "audio",
      timescale: 44100,
      edits: [],
    });
  });
});

describe("parseFragment", () => {
  it("reads samples and the absolute range of their data", () => {
    const [first] = fragmentsOf(video);
    expect(first?.decodeTime).toBe(0);
    expect(first?.samples).toEqual([
      { duration: 1001, size: 100, sync: true, cto: 2002 },
      { duration: 1001, size: 110, sync: false, cto: -1001 },
      { duration: 1001, size: 120, sync: false, cto: 2002 },
    ]);
    const data = first?.data as { start: number; end: number };
    expect(video.bytes[data.start]).toBe(16);
    expect(data.end - data.start + 1).toBe(330);
  });
});

describe("buildProgressive", () => {
  const progressive = buildProgressive([
    {
      source: "v",
      init: parseInit(video.bytes),
      fragments: fragmentsOf(video),
    },
    {
      source: "a",
      init: parseInit(audio.bytes),
      fragments: fragmentsOf(audio),
    },
  ]);
  const mp4 = assemble(progressive);

  it("is a fast-start MP4 of the expected size", () => {
    expect(mp4.byteLength).toBe(progressive.size);
    expect(children(mp4).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
  });

  it("indexes every sample at the right bytes, in order, with its duration", () => {
    const vs = readSamples(mp4, 0);
    expect(vs).toHaveLength(9);
    vs.forEach((s, i) => {
      expect(s.bytes.every((b) => b === 16 + i)).toBe(true);
      expect(s.duration).toBe(1001);
    });
    expect(vs.map((s) => s.sync)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    const as = readSamples(mp4, 1);
    expect(as).toHaveLength(8);
    for (const [i, s] of as.entries()) {
      expect(s.bytes.every((b) => b === 128 + i)).toBe(true);
    }
  });

  it("keeps signed composition offsets and the source edit list", () => {
    const trak = must(findAll(mp4, "trak", must(find(mp4, ["moov"])))[0]);
    const ctts = must(find(mp4, ["mdia", "minf", "stbl", "ctts"], trak));
    expect(mp4[ctts.content]).toBe(1); // version 1: signed
    const elst = must(find(mp4, ["edts", "elst"], trak));
    expect(view(mp4).getInt32(elst.content + 12)).toBe(2002);
  });

  it("interleaves the two tracks' chunks in time order", () => {
    // Video fragments start at 0, 0.100 and 0.200 s; audio ones at 0 and 0.093 s.
    expect(progressive.chunks.map((c) => c.source)).toEqual([
      "v",
      "a",
      "a",
      "v",
      "v",
    ]);
  });

  it("maps any span to header bytes and source ranges", () => {
    const header = progressive.header.byteLength;
    const first = must(progressive.chunks[0]);
    const parts = partsOf(progressive, { start: header - 4, end: header + 9 });
    expect(parts).toEqual([
      { bytes: progressive.header.subarray(header - 4) },
      {
        source: "v",
        range: { start: first.upstream.start, end: first.upstream.start + 9 },
      },
    ]);
    const across = assemble(progressive).subarray(1000, 1400);
    const w = new Writer();
    for (const p of partsOf(progressive, { start: 1000, end: 1399 })) {
      w.bytes(
        "bytes" in p
          ? p.bytes
          : (p.source === "v" ? video.bytes : audio.bytes).subarray(
              p.range.start,
              p.range.end + 1,
            ),
      );
    }
    expect(w.done()).toEqual(across);
  });
});
