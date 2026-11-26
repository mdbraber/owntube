/** ISO BMFF (MP4) box reading and writing, on plain byte arrays. */
export interface Box {
  type: string;
  /** Offset of the box's first byte. */
  start: number;
  /** Whole box, header included. */
  size: number;
  /** Offset of the box's content (after the header). */
  content: number;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The boxes directly inside `[start, end)`. */
export function children(
  bytes: Uint8Array,
  start = 0,
  end = bytes.byteLength,
): Box[] {
  const v = view(bytes);
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = v.getUint32(o);
    const type = String.fromCharCode(
      bytes[o + 4] ?? 0,
      bytes[o + 5] ?? 0,
      bytes[o + 6] ?? 0,
      bytes[o + 7] ?? 0,
    );
    let header = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end)
      throw new Error(`mp4: box ${type} at ${o} overruns its parent`);
    out.push({ type, start: o, size, content: o + header });
    o += size;
  }
  return out;
}

/** Follows a path of box types (`["moov", "trak"]`) and returns the first match. */
export function find(
  bytes: Uint8Array,
  path: readonly string[],
  within?: Box,
): Box | undefined {
  let parent = within;
  for (const type of path) {
    const start = parent ? parent.content : 0;
    const end = parent ? parent.start + parent.size : bytes.byteLength;
    parent = children(bytes, start, end).find((b) => b.type === type);
    if (!parent) return undefined;
  }
  return parent;
}

export function findAll(bytes: Uint8Array, type: string, within: Box): Box[] {
  return children(bytes, within.content, within.start + within.size).filter(
    (b) => b.type === type,
  );
}

export function slice(bytes: Uint8Array, box: Box): Uint8Array {
  return bytes.subarray(box.start, box.start + box.size);
}

/** Builds bytes from parts. */
export class Writer {
  #parts: Uint8Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  bytes(b: Uint8Array): this {
    this.#parts.push(b);
    this.#length += b.byteLength;
    return this;
  }

  u8(n: number): this {
    return this.bytes(Uint8Array.of(n));
  }

  u16(n: number): this {
    const b = new Uint8Array(2);
    view(b).setUint16(0, n);
    return this.bytes(b);
  }

  u32(n: number): this {
    const b = new Uint8Array(4);
    view(b).setUint32(0, n >>> 0);
    return this.bytes(b);
  }

  i32(n: number): this {
    const b = new Uint8Array(4);
    view(b).setInt32(0, n);
    return this.bytes(b);
  }

  u64(n: number): this {
    const b = new Uint8Array(8);
    view(b).setBigUint64(0, BigInt(n));
    return this.bytes(b);
  }

  ascii(s: string): this {
    return this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }

  zeros(n: number): this {
    return this.bytes(new Uint8Array(n));
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let o = 0;
    for (const p of this.#parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }
}

/** A box around `content`. */
export function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const w = new Writer();
  const size = 8 + content.reduce((n, c) => n + c.byteLength, 0);
  w.u32(size).ascii(type);
  for (const c of content) w.bytes(c);
  return w.done();
}

/** A full box: version and flags, then `content`. */
export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...content: Uint8Array[]
): Uint8Array {
  const vf = new Writer()
    .u8(version)
    .u8((flags >> 16) & 0xff)
    .u16(flags & 0xffff)
    .done();
  return box(type, vf, ...content);
}

export function versionAndFlags(
  bytes: Uint8Array,
  b: Box,
): { version: number; flags: number } {
  const v = view(bytes);
  return {
    version: v.getUint8(b.content),
    flags: v.getUint32(b.content) & 0xffffff,
  };
}
