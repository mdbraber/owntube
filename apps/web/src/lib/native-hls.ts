/**
 * The manifest a native HLS player gets: the same master with `for=cast`,
 * which is always the SABR connector's numbered fMP4 segments (see
 * `castMasterPlaylist` in the /hls route). Native players, including an
 * AirPlay receiver fetching it on its own, take that one whatever
 * `INVIDIOUS_COMPANION_SABR_VOD` says; the macOS media stack (an iPad in
 * desktop mode) rejects the byte-range fallback.
 */
export function nativeHlsSrc(src: string): string {
  try {
    const url = new URL(src, "http://placeholder.invalid");
    if (!/^\/hls\/[^/]+\/master\.m3u8$/.test(url.pathname)) return src;
    url.searchParams.set("for", "cast");
    return url.origin === "http://placeholder.invalid"
      ? `${url.pathname}${url.search}`
      : url.toString();
  } catch {
    return src;
  }
}

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
