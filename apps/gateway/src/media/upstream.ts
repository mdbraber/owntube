/** googlevideo serves at most this much per request; larger ranges are fetched in pieces. */
export const UPSTREAM_CHUNK = 8 * 1024 * 1024;

export interface ByteSpan {
  start: number;
  end: number;
}

/** Parses a single-range `Range` header against a file of `size` bytes; null when unsatisfiable. */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteSpan | null {
  if (!header) return { start: 0, end: size - 1 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/** Splits a span into upstream-sized pieces. */
export function chunks(
  span: ByteSpan,
  size: number = UPSTREAM_CHUNK,
): ByteSpan[] {
  const out: ByteSpan[] = [];
  for (let start = span.start; start <= span.end; start += size) {
    out.push({ start, end: Math.min(start + size - 1, span.end) });
  }
  return out;
}

export interface UpstreamSource {
  /** Fetches one piece; must return the piece's bytes as a stream, or throw. */
  fetchPiece(
    piece: ByteSpan,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
}

/**
 * The bytes of `span`, fetched piece by piece as the client reads them.
 * Aborting `signal` (the client went away) stops the upstream request.
 */
export function streamSpan(
  source: UpstreamSource,
  span: ByteSpan,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const pieces = chunks(span);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          const piece = pieces.shift();
          if (!piece) {
            controller.close();
            return;
          }
          reader = (await source.fetchPiece(piece, signal)).getReader();
        }
        const { done, value } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        reader = undefined;
      }
    },
    async cancel() {
      await reader?.cancel();
    },
  });
}

/** A piece of a response: bytes we have, or a span of an upstream source. */
export type ResponsePart =
  | { bytes: Uint8Array }
  | { source: UpstreamSource; span: ByteSpan };

/** The parts one after another, upstream ones fetched piece by piece as the client reads. */
export function streamParts(
  parts: readonly ResponsePart[],
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const queue = [...parts];
  let current: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!current) {
          const part = queue.shift();
          if (!part) {
            controller.close();
            return;
          }
          if ("bytes" in part) {
            controller.enqueue(part.bytes);
            return;
          }
          current = streamSpan(part.source, part.span, signal).getReader();
        }
        const { done, value } = await current.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        current = undefined;
      }
    },
    async cancel() {
      await current?.cancel();
    },
  });
}
