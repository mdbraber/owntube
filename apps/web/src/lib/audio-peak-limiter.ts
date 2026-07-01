/**
 * Web Audio peak limiter for media playback above 1×.
 *
 * Time-stretching at fast speeds (`preservesPitch`) overshoots the [-1, 1]
 * sample range, which the audio device hard-clips into crackle. Instead of
 * bluntly lowering the whole volume, we route the element through a
 * `DynamicsCompressorNode` configured as a brick-wall limiter: it only tames
 * the transient peaks and leaves normal-level audio at full loudness.
 *
 * Hard constraint: `createMediaElementSource()` on a cross-origin element
 * without CORS produces permanent silence (and cannot be undone). We therefore
 * only attach when the current source is same-origin (our media proxies) or an
 * MSE `blob:` URL minted by this page (hls.js). Everything is best-effort —
 * callers must keep the volume-attenuation fallback for when attach fails.
 */

let sharedCtx: AudioContext | null = null;

/** Elements already wired into the graph (one source node per element, ever). */
const wired = new WeakMap<HTMLMediaElement, DynamicsCompressorNode>();

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ??
    null
  );
}

function getSharedContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (!sharedCtx) {
    try {
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

/**
 * True when `createMediaElementSource` is safe (no cross-origin taint → no
 * silent output). MSE `blob:` URLs from hls.js are same-origin and untainted.
 */
export function isSameOriginMediaSrc(
  src: string | null | undefined,
  origin: string = typeof location !== "undefined" ? location.origin : "",
): boolean {
  if (!src) return false;
  if (src.startsWith("blob:")) return true;
  if (!origin) return false;
  try {
    return new URL(src, origin).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Route `el` through the shared limiter graph. Returns `true` when the limiter
 * is active for this element (so the caller can stop attenuating volume).
 * Idempotent: a re-attached element just resumes the context.
 *
 * Only call after a user gesture — attaching while the context is suspended
 * would silence playback until the next `resume()`.
 */
export function attachPeakLimiter(el: HTMLMediaElement | null): boolean {
  if (!el) return false;
  if (wired.has(el)) {
    void getSharedContext()?.resume();
    return true;
  }
  if (!isSameOriginMediaSrc(el.currentSrc)) return false;
  const ctx = getSharedContext();
  if (!ctx) return false;
  try {
    const source = ctx.createMediaElementSource(el);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1; // engage just below full scale
    limiter.knee.value = 0; // hard knee → brick-wall limiting
    limiter.ratio.value = 20; // maximum, near-limiter
    limiter.attack.value = 0.003; // catch transients fast
    limiter.release.value = 0.05;
    source.connect(limiter);
    limiter.connect(ctx.destination);
    wired.set(el, limiter);
    void ctx.resume();
    return true;
  } catch {
    // createMediaElementSource throws if the element already has a source node
    // from another graph, or Web Audio is unavailable. Fall back to attenuation.
    return false;
  }
}

/** Resume the shared context (call from user-gesture handlers). */
export function resumePeakLimiter(): void {
  void sharedCtx?.resume();
}

/** Test seam: drop the shared context and wiring records. */
export function __resetPeakLimiterForTests(): void {
  try {
    void sharedCtx?.close();
  } catch {
    /* ignore */
  }
  sharedCtx = null;
}
