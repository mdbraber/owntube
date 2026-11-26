import { describe, expect, it } from "vitest";
import { parseSidx } from "./sidx.ts";

/** A version-0 sidx box with the given (size, duration) references, timescale 1000. */
function sidx(
  refs: Array<[number, number]>,
  firstOffset = 0,
  leading = 0,
): Uint8Array {
  const size = 32 + refs.length * 12;
  const bytes = new Uint8Array(leading + size);
  const v = new DataView(bytes.buffer);
  let o = leading;
  v.setUint32(o, size);
  bytes.set([0x73, 0x69, 0x64, 0x78], o + 4); // "sidx"
  v.setUint32(o + 8, 0); // version 0, flags
  v.setUint32(o + 12, 1); // reference_ID
  v.setUint32(o + 16, 1000); // timescale
  v.setUint32(o + 20, 0); // earliest_presentation_time
  v.setUint32(o + 24, firstOffset);
  v.setUint16(o + 30, refs.length);
  o += 32;
  for (const [s, d] of refs) {
    v.setUint32(o, s);
    v.setUint32(o + 4, d);
    o += 12;
  }
  return bytes;
}

describe("parseSidx", () => {
  it("turns references into absolute byte ranges", () => {
    // The index range starts at byte 741 of the file; media follows the box.
    const segments = parseSidx(
      sidx([
        [1000, 5000],
        [2000, 4500],
      ]),
      741,
    );
    const mediaStart = 741 + 32 + 24;
    expect(segments).toEqual([
      { range: { start: mediaStart, end: mediaStart + 999 }, durationSec: 5 },
      {
        range: { start: mediaStart + 1000, end: mediaStart + 2999 },
        durationSec: 4.5,
      },
    ]);
  });

  it("finds the box after other data and honours first_offset", () => {
    const [first] = parseSidx(sidx([[10, 1000]], 100, 8), 0);
    expect(first?.range.start).toBe(8 + 44 + 100);
  });

  it("rejects data without a sidx box", () => {
    expect(() => parseSidx(new Uint8Array(64), 0)).toThrow(
      /sidx box not found/,
    );
  });

  it("rejects a truncated box", () => {
    expect(() =>
      parseSidx(
        sidx([
          [1, 1],
          [2, 2],
        ]).slice(0, 40),
        0,
      ),
    ).toThrow(/truncated/);
  });
});
