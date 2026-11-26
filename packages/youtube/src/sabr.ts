import type { Segment } from "@owntube/playback/sidx";
import type { ByteRange } from "@owntube/playback/tracks";
import { clusterTimecode } from "@owntube/playback/webm";
import type { ClientInfo } from "googlevideo/protos";
import { SabrStream } from "googlevideo/sabr-stream";
import type { SabrFormat } from "googlevideo/shared-types";
import { buildSabrFormat, EnabledTrackTypes } from "googlevideo/utils";
import type { ClientIdentity } from "./clients.ts";
import type { RawFormat, RawPlayerResponse } from "./player.ts";

/**
 * YouTube rejected the stream's attestation: this identity needs a PO token
 * (or a fresh identity) before SABR will continue.
 */
export class AttestationRequired extends Error {
  constructor() {
    super("sabr: stream protection attestation rejected");
  }
}

/** Where and as whom a video is streamed over SABR. */
export interface SabrEndpoint {
  videoId: string;
  streamingUrl: string;
  ustreamerConfig: string;
  clientInfo: ClientInfo;
  formats: SabrFormat[];
  /** Egress-bound fetch with the identity's user agent. */
  fetch: typeof globalThis.fetch;
  /** Mints a PO token when the SABR server asks for attestation; without one, a rejection ends the pull. */
  mintPoToken?: () => Promise<Uint8Array>;
  /** Hears every stream-protection status (1 OK, 2 attestation pending, 3 rejected). */
  onProtectionStatus?: (status: number) => void;
  /** Asked when the SABR server demands a new player response mid-stream; `token` must be echoed. */
  reload?: (
    token: string | undefined,
  ) => Promise<{ streamingUrl: string; ustreamerConfig: string }>;
}

/** The SABR endpoint of a player response, or undefined when it has none. */
export function sabrEndpoint(
  videoId: string,
  raw: RawPlayerResponse,
  identity: ClientIdentity,
  fetch: typeof globalThis.fetch,
): SabrEndpoint | undefined {
  const streamingUrl = raw.streamingData?.serverAbrStreamingUrl;
  const ustreamerConfig =
    raw.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig
      ?.videoPlaybackUstreamerConfig;
  if (!streamingUrl || !ustreamerConfig) return undefined;
  const text = (key: string) =>
    typeof identity.context[key] === "string"
      ? (identity.context[key] as string)
      : undefined;
  const clientInfo: ClientInfo = {
    clientName: identity.id,
    clientVersion: identity.version,
  };
  for (const key of [
    "osName",
    "osVersion",
    "deviceMake",
    "deviceModel",
  ] as const) {
    const value = text(key);
    if (value) clientInfo[key] = value;
  }
  const withAgent: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("user-agent", identity.userAgent);
    return fetch(input, { ...init, headers });
  };
  return {
    videoId,
    streamingUrl,
    ustreamerConfig,
    clientInfo,
    formats: (raw.streamingData?.adaptiveFormats ?? []).map((f: RawFormat) =>
      buildSabrFormat({ ...f, bitrate: f.bitrate ?? 0 }),
    ),
    fetch: withAgent,
  };
}

export interface SabrTrackOptions {
  kind: "video" | "audio";
  /** How fragments are recognised: fMP4 by `mfhd` sequence, WebM clusters by Timecode (= their cue time). */
  container: "mp4" | "webm";
  itag: number;
  /** For dubbed audio: which language's track (`audioTrack.id`). */
  audioTrackId?: string;
  /** The audio format a video pull is paired with (SABR always sends some audio with video). */
  companionAudioItag: number;
  /** The file's fragments, from its index (lazily: over SABR the index itself comes through this track). */
  segments: () => Promise<readonly Segment[]>;
  /** Last byte of the file's index: a stream starts with bytes 0..indexEnd (ftyp, moov, sidx). */
  indexEnd: number;
  /** Fragments kept after reading, for players that re-request a range. */
  keep?: number;
}

/** Opens a byte stream of one track from a start time (SABR in production; injectable for tests). */
export type StreamOpener = (startTimeMs: number) => {
  stream: ReadableStream<ArrayBufferView>;
  close(): Promise<void>;
};

/** The SABR stream of `o`'s track from a start time; the other track SABR sends along is drained. */
export function sabrOpener(
  endpoint: () => SabrEndpoint,
  o: SabrTrackOptions,
): StreamOpener {
  return (startTimeMs) => {
    const e = endpoint();
    const reload = e.reload;
    const callbacks: NonNullable<
      ConstructorParameters<typeof SabrStream>[0]["callbacks"]
    > = {};
    if (reload) {
      callbacks.onReloadPlayerResponse = async (context) => {
        const fresh = await reload(context?.reloadPlaybackParams?.token);
        return {
          serverAbrStreamingUrl: fresh.streamingUrl,
          videoPlaybackUstreamerConfig: fresh.ustreamerConfig,
        };
      };
    }
    if (e.mintPoToken) callbacks.onMintPoToken = e.mintPoToken;
    const stream = new SabrStream({
      videoId: e.videoId,
      fetchFunction: e.fetch,
      serverAbrStreamingUrl: e.streamingUrl,
      videoPlaybackUstreamerConfig: e.ustreamerConfig,
      clientInfo: e.clientInfo,
      formats: e.formats,
      callbacks,
    });
    const audioItag = o.kind === "audio" ? o.itag : o.companionAudioItag;
    const started = stream.start({
      ...(o.kind === "video" ? { videoFormat: o.itag } : {}),
      audioFormat: (formats: SabrFormat[]) =>
        formats.find(
          (f) =>
            f.itag === audioItag &&
            !f.isDrc &&
            (!o.audioTrackId || f.audioTrackId === o.audioTrackId),
        ),
      startTimeMs,
      isPostLiveDvr: false,
      enabledTrackTypes:
        o.kind === "video"
          ? EnabledTrackTypes.VIDEO_ONLY
          : EnabledTrackTypes.AUDIO_ONLY,
    });
    // SABR sends audio along with video regardless of what was asked.
    const other =
      o.kind === "video" ? started.audioStream : started.videoStream;
    void other.pipeTo(new WritableStream()).catch(() => {});
    const out = failable(
      o.kind === "video" ? started.videoStream : started.audioStream,
    );
    stream.on("error", (error) => out.fail(error));
    // Without a token to offer, a rejection is final: stop now instead of after googlevideo's retries.
    stream.on("streamProtectionStatusUpdate", (status) => {
      if (status.status !== undefined) e.onProtectionStatus?.(status.status);
      if (status.status === 3 && !e.mintPoToken) {
        out.fail(new AttestationRequired());
        void stream.abort().catch(() => {});
      }
    });
    return {
      stream: out.stream,
      close: async () => {
        await stream.abort().catch(() => {});
      },
    };
  };
}

/** A stream that can be made to fail from outside (when the SABR session errors). */
function failable(inner: ReadableStream<ArrayBufferView>) {
  const reader = inner.getReader();
  let failure: Error | undefined;
  let wake: ((error: Error) => void) | undefined;
  const stream = new ReadableStream<ArrayBufferView>({
    async pull(controller) {
      if (failure) return controller.error(failure);
      const failed = new Promise<never>((_, reject) => {
        wake = reject;
      });
      try {
        const { done, value } = await Promise.race([reader.read(), failed]);
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      } finally {
        wake = undefined;
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return {
    stream,
    fail(error: Error) {
      failure ??= error;
      wake?.(failure);
    },
  };
}

/**
 * One fMP4 track of a video, read by byte range over SABR. SABR delivers the
 * file's own bytes (measured 2026-11-26: init, index and fragments identical
 * to byte-range reads), so a range maps onto fragments from the index. A pull
 * keeps going while reads are sequential and restarts at the right time on a
 * jump. Each fragment says which one it is (fMP4: the `mfhd` sequence number,
 * index + 1; WebM: the cluster Timecode, its cue time), which confirms where a
 * pull actually is.
 */
export class SabrTrack {
  readonly #o: SabrTrackOptions;
  readonly #open: StreamOpener;
  #prefix: Uint8Array | undefined;
  #pull: Pull | undefined;
  readonly #kept = new Map<number, Uint8Array>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: SabrTrackOptions, open: StreamOpener) {
    this.#o = options;
    this.#open = open;
  }

  /** Bytes `range` of the track's file. Reads on one track are served one after another. */
  async read(range: ByteRange): Promise<Uint8Array> {
    // The fragment list is resolved before joining the queue: it may itself be
    // read through this track (the index is in the prefix), and would otherwise
    // wait behind the read that needs it.
    const segments =
      range.end > this.#o.indexEnd ? await this.#o.segments() : undefined;
    const run = this.#queue.then(() =>
      this.#read(range, segments).catch(async (error: unknown) => {
        // A failed pull cannot be resumed; the next read starts a new one.
        await this.close();
        throw error;
      }),
    );
    this.#queue = run.catch(() => {});
    return run;
  }

  async close(): Promise<void> {
    await this.#pull?.close();
    this.#pull = undefined;
  }

  async #read(
    range: ByteRange,
    segments: readonly Segment[] | undefined,
  ): Promise<Uint8Array> {
    const out = new Uint8Array(range.end - range.start + 1);
    if (range.start <= this.#o.indexEnd) {
      if (!this.#prefix) await this.#startAt(0, undefined);
      const prefix = this.#prefix as Uint8Array;
      out.set(
        prefix.subarray(range.start, Math.min(range.end, this.#o.indexEnd) + 1),
        0,
      );
    }
    if (!segments) return out;
    for (const [k, seg] of segments.entries()) {
      if (seg.range.end < range.start || seg.range.start > range.end) continue;
      const bytes = await this.#fragment(k, segments);
      const from = Math.max(range.start, seg.range.start);
      const to = Math.min(range.end, seg.range.end);
      out.set(
        bytes.subarray(from - seg.range.start, to - seg.range.start + 1),
        from - range.start,
      );
    }
    return out;
  }

  async #fragment(
    k: number,
    segments: readonly Segment[],
  ): Promise<Uint8Array> {
    const kept = this.#kept.get(k);
    if (kept) return kept;
    if (!this.#pull || this.#pull.next !== k) await this.#startAt(k, segments);
    const pull = this.#pull as Pull;
    for (;;) {
      const index = pull.next;
      const seg = segments[index];
      if (!seg) throw new Error(`sabr: no fragment ${k}`);
      const bytes = await pull.take(seg.range.end - seg.range.start + 1);
      const found = fragmentIndex(bytes, this.#o.container, segments);
      if (found !== index)
        throw new Error(`sabr: expected fragment ${index}, got ${found}`);
      pull.next = index + 1;
      this.#keep(index, bytes);
      if (index === k) return bytes;
    }
  }

  /** Starts a pull at fragment `k` (or at the start, for the prefix, before the fragments are known). */
  async #startAt(
    k: number,
    segments: readonly Segment[] | undefined,
  ): Promise<void> {
    await this.#pull?.close();
    const startMs = (segments ?? [])
      .slice(0, k)
      .reduce((ms, s) => ms + s.durationSec * 1000, 0);
    const pull = new Pull(this.#open(Math.round(startMs)));
    this.#pull = pull;
    // Every stream starts with the file's first bytes up to the end of its index.
    const prefix = await pull.take(this.#o.indexEnd + 1);
    this.#prefix ??= prefix;
    pull.next = k;
    if (segments) await pull.alignTo(k, segments, this.#o.container);
  }

  #keep(index: number, bytes: Uint8Array): void {
    this.#kept.set(index, bytes);
    const keep = this.#o.keep ?? 3;
    for (const key of this.#kept.keys()) {
      if (this.#kept.size <= keep) break;
      this.#kept.delete(key);
    }
  }
}

/** One stream from a start time, read as exact byte counts. */
class Pull {
  next = 0;
  readonly #opened: ReturnType<StreamOpener>;
  readonly #reader: ReadableStreamDefaultReader<ArrayBufferView>;
  #buffer = new Uint8Array(0);

  constructor(opened: ReturnType<StreamOpener>) {
    this.#opened = opened;
    this.#reader = opened.stream.getReader();
  }

  /** The next `n` bytes of the stream. */
  async take(n: number): Promise<Uint8Array> {
    await this.#fill(n);
    const out = this.#buffer.slice(0, n);
    this.#buffer = this.#buffer.subarray(n);
    return out;
  }

  /** Skips whole fragments until the next one is `k`. */
  async alignTo(
    k: number,
    segments: readonly Segment[],
    container: SabrTrackOptions["container"],
  ): Promise<void> {
    for (;;) {
      await this.#fill(24);
      const index = fragmentIndex(this.#buffer, container, segments);
      if (index === k) return;
      if (index === undefined || index > k)
        throw new Error(`sabr: stream at fragment ${index}, wanted ${k}`);
      const seg = segments[index] as Segment;
      await this.take(seg.range.end - seg.range.start + 1);
      this.next = index + 1;
    }
  }

  async close(): Promise<void> {
    await this.#reader.cancel().catch(() => {});
    await this.#opened.close();
  }

  async #fill(n: number): Promise<void> {
    while (this.#buffer.byteLength < n) {
      const { done, value } = await this.#reader.read();
      if (done) throw new Error("sabr: stream ended early");
      const chunk = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      const merged = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
      merged.set(this.#buffer);
      merged.set(chunk, this.#buffer.byteLength);
      this.#buffer = merged;
    }
  }
}

/** Which fragment (by index) starts at the beginning of `bytes`, or undefined when none does. */
export function fragmentIndex(
  bytes: Uint8Array,
  container: SabrTrackOptions["container"],
  segments: readonly Segment[],
): number | undefined {
  if (container === "mp4") return mfhdSequence(bytes) - 1;
  const time = clusterTimecode(bytes);
  const index = segments.findIndex((s) => s.time === time);
  return index < 0 ? undefined : index;
}

/** The `mfhd` sequence number of the moof at the start of `bytes`. */
export function mfhdSequence(bytes: Uint8Array): number {
  const type = String.fromCharCode(...bytes.subarray(4, 8));
  const inner = String.fromCharCode(...bytes.subarray(12, 16));
  if (type !== "moof" || inner !== "mfhd")
    throw new Error("sabr: fragment does not start with moof/mfhd");
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(20);
}
