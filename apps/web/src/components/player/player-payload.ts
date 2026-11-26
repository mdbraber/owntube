/** A subtitle track ready to attach to a `<video>` (same-origin VTT src). */
export type CaptionTrack = {
  label: string;
  languageCode: string;
  /** The gateway's signed WebVTT URL. */
  src: string;
  /** Start track when captions are on (account caption language). */
  isDefault?: boolean;
};

/**
 * What the player plays: the gateway's signed manifests. VOD plays DASH where
 * the browser can (MSE, not iOS) and HLS elsewhere; live and post-live DVR
 * exist only as HLS.
 */
export type VideoPlayerPayload = {
  mode: "hls";
  /** The signed HLS master playlist. */
  src: string;
  /** The signed DASH manifest; null for live and DVR. */
  dash: string | null;
  /** Post-live DVR: an ended stream YouTube has not turned into a VOD yet. */
  dvr?: boolean;
};
