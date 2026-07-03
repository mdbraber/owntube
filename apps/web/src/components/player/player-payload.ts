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
