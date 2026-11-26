import type { ByteRange } from "../tracks.ts";
import {
  type Box,
  find,
  findAll,
  slice,
  versionAndFlags,
  view,
} from "./boxes.ts";

/** What a single-track fragmented MP4's init segment says about its track. */
export interface TrackInit {
  kind: "video" | "audio";
  /** Media timescale (mdhd). */
  timescale: number;
  /** mdhd language, packed ISO-639-2 (2 bytes). */
  language: number;
  /** tkhd width and height, 16.16 fixed point. */
  width: number;
  height: number;
  /** Boxes copied as they are into the progressive file. */
  hdlr: Uint8Array;
  mediaHeader: Uint8Array;
  dinf: Uint8Array;
  stsd: Uint8Array;
  /** Edit list, durations in seconds; media times in the media timescale. */
  edits: Array<{ durationSec: number; mediaTime: number }>;
  defaults: { duration: number; size: number; flags: number };
}

export interface Sample {
  duration: number;
  size: number;
  sync: boolean;
  /** Composition time offset (may be negative). */
  cto: number;
}

/** One fragment's samples and where their data is in the file. */
export interface Fragment {
  decodeTime: number;
  samples: Sample[];
  data: ByteRange;
}

/** Reads big-endian fields one after another. */
class Cursor {
  readonly #v: DataView;
  offset: number;
  constructor(v: DataView, offset: number) {
    this.#v = v;
    this.offset = offset;
  }
  u32(): number {
    const x = this.#v.getUint32(this.offset);
    this.offset += 4;
    return x;
  }
  i32(): number {
    const x = this.#v.getInt32(this.offset);
    this.offset += 4;
    return x;
  }
  u64(): number {
    const x = Number(this.#v.getBigUint64(this.offset));
    this.offset += 8;
    return x;
  }
  i64(): number {
    const x = Number(this.#v.getBigInt64(this.offset));
    this.offset += 8;
    return x;
  }
  skip(n: number): void {
    this.offset += n;
  }
}

export function parseInit(bytes: Uint8Array): TrackInit {
  const v = view(bytes);
  const moov = need(find(bytes, ["moov"]), "moov");
  const trak = need(find(bytes, ["trak"], moov), "trak");
  const mdia = need(find(bytes, ["mdia"], trak), "mdia");
  const minf = need(find(bytes, ["minf"], mdia), "minf");
  const stbl = need(find(bytes, ["stbl"], minf), "stbl");
  const hdlr = need(find(bytes, ["hdlr"], mdia), "hdlr");
  const handler = String.fromCharCode(
    ...bytes.subarray(hdlr.content + 8, hdlr.content + 12),
  );
  if (handler !== "vide" && handler !== "soun")
    throw new Error(`mp4: unsupported handler ${handler}`);

  const mdhd = need(find(bytes, ["mdhd"], mdia), "mdhd");
  const mdhdV1 = versionAndFlags(bytes, mdhd).version === 1;
  const timescale = v.getUint32(mdhd.content + (mdhdV1 ? 20 : 12));
  const language = v.getUint16(mdhd.content + (mdhdV1 ? 32 : 20));

  const tkhd = need(find(bytes, ["tkhd"], trak), "tkhd");
  const tkhdEnd = tkhd.start + tkhd.size;

  const mvhd = need(find(bytes, ["mvhd"], moov), "mvhd");
  const movieScale = v.getUint32(
    mvhd.content + (versionAndFlags(bytes, mvhd).version === 1 ? 20 : 12),
  );
  const edits: TrackInit["edits"] = [];
  const elst = find(bytes, ["edts", "elst"], trak);
  if (elst) {
    const elstV1 = versionAndFlags(bytes, elst).version === 1;
    const c = new Cursor(v, elst.content + 4);
    const count = c.u32();
    for (let entry = 0; entry < count; entry++) {
      const duration = elstV1 ? c.u64() : c.u32();
      const mediaTime = elstV1 ? c.i64() : c.i32();
      c.skip(4); // media rate
      edits.push({ durationSec: duration / movieScale, mediaTime });
    }
  }

  const trex = find(bytes, ["mvex", "trex"], moov);
  const defaults = trex
    ? {
        duration: v.getUint32(trex.content + 12),
        size: v.getUint32(trex.content + 16),
        flags: v.getUint32(trex.content + 20),
      }
    : { duration: 0, size: 0, flags: 0 };

  return {
    kind: handler === "vide" ? "video" : "audio",
    timescale,
    language,
    width: v.getUint32(tkhdEnd - 8),
    height: v.getUint32(tkhdEnd - 4),
    hdlr: slice(bytes, hdlr),
    mediaHeader: slice(
      bytes,
      need(
        find(bytes, [handler === "vide" ? "vmhd" : "smhd"], minf),
        "media header",
      ),
    ),
    dinf: slice(bytes, need(find(bytes, ["dinf"], minf), "dinf")),
    stsd: slice(bytes, need(find(bytes, ["stsd"], stbl), "stsd")),
    edits,
    defaults,
  };
}

/** Size of the `moof` box at the start of `bytes` (a fragment's first bytes). */
export function moofSize(bytes: Uint8Array): number {
  if (
    bytes.byteLength < 8 ||
    String.fromCharCode(...bytes.subarray(4, 8)) !== "moof"
  ) {
    throw new Error("mp4: fragment does not start with moof");
  }
  return view(bytes).getUint32(0);
}

/**
 * Reads a fragment's samples from its `moof`. `bytes` starts at the moof,
 * which is at `fileOffset` in the file.
 */
export function parseFragment(
  bytes: Uint8Array,
  fileOffset: number,
  init: TrackInit,
): Fragment {
  const v = view(bytes);
  const moof: Box = {
    type: "moof",
    start: 0,
    size: moofSize(bytes),
    content: 8,
  };
  const traf = need(find(bytes, ["traf"], moof), "traf");

  const tfhd = need(find(bytes, ["tfhd"], traf), "tfhd");
  const tf = versionAndFlags(bytes, tfhd).flags;
  const h = new Cursor(v, tfhd.content + 8); // version/flags, track_ID
  // Without an explicit base, offsets count from the moof's first byte.
  const base = tf & 0x1 ? h.u64() : fileOffset;
  if (tf & 0x2) h.skip(4); // sample_description_index
  const defaults = { ...init.defaults };
  if (tf & 0x8) defaults.duration = h.u32();
  if (tf & 0x10) defaults.size = h.u32();
  if (tf & 0x20) defaults.flags = h.u32();

  const tfdt = find(bytes, ["tfdt"], traf);
  const decodeTime = tfdt
    ? versionAndFlags(bytes, tfdt).version === 1
      ? Number(v.getBigUint64(tfdt.content + 4))
      : v.getUint32(tfdt.content + 4)
    : 0;

  const samples: Sample[] = [];
  let dataStart = -1;
  let next = -1;
  for (const trun of findAll(bytes, "trun", traf)) {
    const { version, flags } = versionAndFlags(bytes, trun);
    const c = new Cursor(v, trun.content + 4);
    const count = c.u32();
    let offset = flags & 0x1 ? base + c.i32() : next >= 0 ? next : base;
    if (next >= 0 && offset !== next)
      throw new Error("mp4: fragment sample data is not contiguous");
    if (dataStart < 0) dataStart = offset;
    const firstFlags = flags & 0x4 ? c.u32() : undefined;
    for (let i = 0; i < count; i++) {
      const duration = flags & 0x100 ? c.u32() : defaults.duration;
      const size = flags & 0x200 ? c.u32() : defaults.size;
      let sampleFlags = flags & 0x400 ? c.u32() : defaults.flags;
      if (i === 0 && firstFlags !== undefined) sampleFlags = firstFlags;
      // Version 1 composition offsets are signed.
      const cto = flags & 0x800 ? (version === 1 ? c.i32() : c.u32()) : 0;
      samples.push({
        duration,
        size,
        sync: (sampleFlags & 0x10000) === 0,
        cto,
      });
      offset += size;
    }
    next = offset;
  }
  if (samples.length === 0) throw new Error("mp4: fragment without samples");
  return { decodeTime, samples, data: { start: dataStart, end: next - 1 } };
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`mp4: no ${what}`);
  return value;
}
