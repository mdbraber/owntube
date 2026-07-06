/** A subtitle track ready to attach to a `<video>` (same-origin VTT src). */
export type CaptionTrack = {
  label: string;
  languageCode: string;
  /** Same-origin `/captions/{videoId}?label=…` URL serving WebVTT. */
  src: string;
};

export type ProxiedVariant =
  | { t: "muxed"; label: string; src: string }
  | {
      t: "split";
      label: string;
      video: string;
      audio: string;
      audioTracks: { label: string; src: string }[];
      defaultAudioIndex?: number;
    };

export type VideoPlayerPayload =
  | { mode: "hls"; src: string }
  | { mode: "progressive"; variants: ProxiedVariant[] };
