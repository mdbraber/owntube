import type { ByteRange } from "./tracks.ts";

/** One fragment of an fMP4 file, from its `sidx` box. */
export interface Segment {
  range: ByteRange;
  durationSec: number;
  /** Start in the container's own time units, where the container identifies fragments by time (WebM: the cue time). */
  time?: number;
}

/**
 * Reads an fMP4 segment index. `bytes` is the file's index range, which
 * starts at `indexStart`; the segments' byte ranges are absolute in the file.
 */
export function parseSidx(bytes: Uint8Array, indexStart: number): Segment[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = findBox(bytes, "sidx");
  const boxSize = view.getUint32(base);
  let o = base + 8;
  const version = view.getUint8(o);
  o += 8; // version + flags, reference_ID
  const timescale = view.getUint32(o);
  o += 4;
  let firstOffset: number;
  if (version === 0) {
    firstOffset = view.getUint32(o + 4);
    o += 8;
  } else {
    firstOffset = Number(view.getBigUint64(o + 8));
    o += 16;
  }
  o += 2; // reserved
  const count = view.getUint16(o);
  o += 2;
  if (timescale === 0 || o + count * 12 > bytes.byteLength)
    throw new Error("sidx: truncated or invalid");
  const segments: Segment[] = [];
  let offset = indexStart + base + boxSize + firstOffset;
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(o) & 0x7fffffff;
    const duration = view.getUint32(o + 4);
    o += 12;
    segments.push({
      range: { start: offset, end: offset + size - 1 },
      durationSec: duration / timescale,
    });
    offset += size;
  }
  return segments;
}

function findBox(bytes: Uint8Array, type: string): number {
  const code = [...type].map((c) => c.charCodeAt(0));
  for (let i = 4; i + 4 <= bytes.byteLength; i++) {
    if (code.every((c, k) => bytes[i + k] === c)) return i - 4;
  }
  throw new Error(`${type} box not found`);
}
