import type { Segment } from "./sidx.ts";

/**
 * Just enough EBML to read a WebM file's index: where the Segment's data
 * starts, its timecode scale and duration (from the init range) and the cue
 * points (from the index range), turned into one segment per cluster.
 */
const ID = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueClusterPosition: 0xf1,
  cluster: 0x1f43b675,
  timecode: 0xe7,
} as const;

interface Element {
  id: number;
  /** Offset of the element's data. */
  data: number;
  /** Data size; undefined for "unknown size" (live-style) elements. */
  size: number | undefined;
}

/** A variable-length integer: its value (marker kept for IDs, stripped for sizes) and length. */
function vint(
  bytes: Uint8Array,
  o: number,
  keepMarker: boolean,
): { value: number; length: number; allOnes: boolean } {
  const first = bytes[o];
  if (first === undefined || first === 0)
    throw new Error("webm: bad variable-length integer");
  const length = Math.clz32(first) - 23;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = bytes[o + i];
    if (b === undefined) throw new Error("webm: truncated");
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, allOnes };
}

function element(bytes: Uint8Array, o: number): Element {
  const id = vint(bytes, o, true);
  const size = vint(bytes, o + id.length, false);
  return {
    id: id.value,
    data: o + id.length + size.length,
    size: size.allOnes ? undefined : size.value,
  };
}

function uint(bytes: Uint8Array, e: Element): number {
  let v = 0;
  for (let i = 0; i < (e.size ?? 0); i++)
    v = v * 256 + (bytes[e.data + i] as number);
  return v;
}

function float(bytes: Uint8Array, e: Element): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset + e.data, e.size);
  return e.size === 4 ? v.getFloat32(0) : v.getFloat64(0);
}

/** The children of the element whose data spans `[start, end)`. */
function* children(
  bytes: Uint8Array,
  start: number,
  end: number,
): Generator<Element> {
  let o = start;
  while (o < end) {
    const e = element(bytes, o);
    yield e;
    if (e.size === undefined) return;
    o = e.data + e.size;
  }
}

export interface WebmInit {
  /** File offset of the Segment element's data; cue positions count from here. */
  segmentDataStart: number;
  /** Nanoseconds per timecode unit (default 1 ms). */
  timecodeScale: number;
  /** In timecode units, when the file says. */
  duration: number | undefined;
}

/** Reads the init range (EBML header, Segment start, Info). */
export function parseWebmInit(bytes: Uint8Array): WebmInit {
  let o = 0;
  for (;;) {
    const e = element(bytes, o);
    if (e.id === ID.segment) {
      let timecodeScale = 1_000_000;
      let duration: number | undefined;
      for (const child of children(bytes, e.data, bytes.byteLength)) {
        if (child.id === ID.info) {
          for (const field of children(
            bytes,
            child.data,
            child.data + (child.size ?? 0),
          )) {
            if (field.id === ID.timecodeScale)
              timecodeScale = uint(bytes, field);
            if (field.id === ID.duration) duration = float(bytes, field);
          }
        }
        if (child.data + (child.size ?? 0) >= bytes.byteLength) break;
      }
      return { segmentDataStart: e.data, timecodeScale, duration };
    }
    if (e.size === undefined) throw new Error("webm: no Segment");
    o = e.data + e.size;
  }
}

/**
 * Reads the Cues in the index range (which starts at file offset
 * `indexStart`) into one segment per cluster, ending where the next begins
 * (the last at the end of the file).
 */
export function parseCues(
  bytes: Uint8Array,
  init: WebmInit,
  contentLength: number,
): Segment[] {
  const cues = element(bytes, 0);
  if (cues.id !== ID.cues) throw new Error("webm: index is not Cues");
  const points: Array<{ time: number; position: number }> = [];
  for (const point of children(
    bytes,
    cues.data,
    cues.data + (cues.size ?? bytes.byteLength),
  )) {
    if (point.id !== ID.cuePoint) continue;
    let time: number | undefined;
    let position: number | undefined;
    for (const field of children(
      bytes,
      point.data,
      point.data + (point.size ?? 0),
    )) {
      if (field.id === ID.cueTime) time = uint(bytes, field);
      if (field.id === ID.cueTrackPositions && position === undefined) {
        for (const p of children(
          bytes,
          field.data,
          field.data + (field.size ?? 0),
        )) {
          if (p.id === ID.cueClusterPosition) position = uint(bytes, p);
        }
      }
    }
    if (time !== undefined && position !== undefined)
      points.push({ time, position });
  }
  if (points.length === 0) throw new Error("webm: no cue points");
  const unit = init.timecodeScale / 1e9;
  return points.map((p, i) => {
    const next = points[i + 1];
    const start = init.segmentDataStart + p.position;
    const end = next
      ? init.segmentDataStart + next.position - 1
      : contentLength - 1;
    const endTime = next?.time ?? init.duration ?? p.time;
    return {
      range: { start, end },
      durationSec: (endTime - p.time) * unit,
      time: p.time,
    };
  });
}

/** The Timecode of the cluster at the start of `bytes`, or undefined when it is not a cluster. */
export function clusterTimecode(bytes: Uint8Array): number | undefined {
  const cluster = element(bytes, 0);
  if (cluster.id !== ID.cluster) return undefined;
  const first = element(bytes, cluster.data);
  return first.id === ID.timecode ? uint(bytes, first) : undefined;
}
