import type { HlsConfig } from "hls.js";

/**
 * hls.js settings for VOD. The gateway's manifests are same-origin and
 * session-relative, so nothing is rewritten; these only tune buffering and
 * leave captions to the player's own `<track>`s.
 */
export function hlsVodConfig(): Partial<HlsConfig> {
  return {
    // Don't let hls.js manage native text tracks: it would create its own
    // CEA-608 track and reset TextTrack modes, clobbering the sidecar
    // `<track>` captions that `usePlayerCaptions` drives.
    renderTextTracksNatively: false,
    // Drop the TimelineController outright: on every MANIFEST_LOADING it
    // clears the cues of *every* TextTrack on the element, so the sidecar
    // captions went blank until the <track> was reloaded.
    timelineController: undefined,
    startFragPrefetch: true,
    // hls.js defaults to ManagedMediaSource wherever it exists — iPadOS/macOS
    // Safari expose it next to real MSE. MMS stopped hls.js ~30s ahead and
    // never sent `startstreaming` after a seek, so seeks on iPad stalled for
    // good. Use real MSE when present (MMS-only iPhones take native HLS).
    preferManagedMediaSource: false,
    // A deep buffer absorbs an occasional slow segment instead of stalling.
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    // The 60MB default byte cap would limit the cushion well under the time
    // targets above on high-bitrate video.
    maxBufferSize: 120 * 1000 * 1000,
    maxBufferHole: 0.5,
  };
}
