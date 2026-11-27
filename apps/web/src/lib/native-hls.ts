/**
 * Whether to play our HLS natively instead of through hls.js.
 *
 * On iPhone and iPad always: native playback is hardware-decoded and is the
 * only kind AirPlay can take over. An iPad AirPlays one element at a time,
 * and only one holding a plain URL; an hls.js element (a `blob:` from Media
 * Source) sends just its sound. That includes an iPad in "Request Desktop
 * Website" mode, which has a real `MediaSource` and so used to get hls.js.
 *
 * Elsewhere only when the browser has native HLS and no real Media Source.
 */
export function prefersNativeHls(opts: {
  canPlayNativeHls: boolean;
  hasRealMediaSource: boolean;
  iosLike: boolean;
}): boolean {
  if (!opts.canPlayNativeHls) return false;
  return opts.iosLike || !opts.hasRealMediaSource;
}
