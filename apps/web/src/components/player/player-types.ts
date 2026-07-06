import type { CaptionModel } from "@/components/player/player-captions";
import type { CaptionTrack } from "@/components/player/player-payload";
import type {
  AudioModel,
  ProgressiveQualityMenu,
  QualityModel,
} from "@/components/player/player-quality";
import type { ScrubPreviewConfig } from "@/hooks/use-scrub-frame-preview";
import type { SponsorBlockSegment } from "@/lib/sponsorblock";
import type { SponsorBlockPrefs } from "@/lib/sponsorblock-prefs";
import type { VideoChapter } from "@/lib/video-chapters";

export type SponsorBlockChromeProps = {
  videoId: string;
  sponsorSegments: SponsorBlockSegment[];
  sponsorBlockPrefs: SponsorBlockPrefs;
};

export type PlayerAdapter = {
  paused: boolean;
  waiting: boolean;
  canPlay: boolean;
  duration: number;
  currentTime: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  play(): void;
  pause(): void;
  togglePaused(): void;
  seek(t: number): void;
  seekPreview(t: number): void;
  setVolume(v: number): void;
  toggleMuted(): void;
  setPlaybackRate(r: number): void;
  canPictureInPicture: boolean;
  pictureInPicture: boolean;
  togglePictureInPicture(): void;
};

export type ChromeProps = SponsorBlockChromeProps & {
  adapter: PlayerAdapter;
  shellRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  chapters: VideoChapter[];
  quality: QualityModel;
  audio: AudioModel;
  captions: CaptionModel;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  cinemaMode: boolean;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  scrubPreview?: ScrubPreviewConfig | null;
  centerHint?: { kind: "play" | "pause"; tick: number } | null;
  nextUp?: { href: string; title: string } | null;
  queue?: { href: string; title: string }[];
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  onPlayNext: () => void;
  miniMode?: boolean;
  shortsMode?: boolean;
  miniStartPaused?: boolean;
  isLive?: boolean;
};

export type HlsBlockProps = SponsorBlockChromeProps & {
  src: string;
  title: string;
  poster?: string;
  reactKey: string;
  captions?: CaptionTrack[];
  progressiveQualityMenu: ProgressiveQualityMenu | null;
  setQualityIndex: (i: number, seekSeconds?: number) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  chapters: VideoChapter[];
  startAtSeconds?: number;
  cinemaMode: boolean;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  scrubPreview?: ScrubPreviewConfig | null;
  onPlaybackError?: () => void;
  onEnded?: () => void;
  nextUp?: { href: string; title: string } | null;
  queue?: { href: string; title: string }[];
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  onPlayNext: () => void;
  miniMode?: boolean;
  shortsMode?: boolean;
  miniStartPaused?: boolean;
  /** Autoplay on the full watch page (user setting). */
  autoplay?: boolean;
  restoredVolume?: number;
  restoredMuted?: boolean;
  onVideoIntrinsics?: (width: number, height: number) => void;
  isLive?: boolean;
};
