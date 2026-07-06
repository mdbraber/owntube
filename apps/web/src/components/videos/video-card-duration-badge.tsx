import { cn } from "@/lib/utils";
import {
  formatThumbnailBadge,
  type ThumbnailBadgeInput,
} from "@/lib/video-display";

type VideoCardDurationBadgeProps = ThumbnailBadgeInput & {
  className?: string;
  /**
   * When false, the badge renders in-flow (no absolute positioning) so it can
   * sit inside a caller-provided flex row — e.g. beside the playlist pill.
   */
  positioned?: boolean;
};

export function VideoCardDurationBadge({
  className,
  isLive,
  isUpcoming,
  positioned = true,
  ...input
}: VideoCardDurationBadgeProps) {
  if (isLive && !isUpcoming) {
    return (
      <span
        className={cn(
          "ot-video-duration-badge pointer-events-none z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ot-brand-gradient shadow-sm",
          positioned && "absolute bottom-2 right-2",
          className,
        )}
      >
        Live
      </span>
    );
  }

  const label = formatThumbnailBadge({ ...input, isLive, isUpcoming });
  if (!label) return null;
  const upcomingAccent = isUpcoming === true;
  return (
    <span
      className={cn(
        "ot-video-duration-badge pointer-events-none rounded-md font-mono font-semibold tabular-nums backdrop-blur-sm",
        positioned && "absolute",
        upcomingAccent
          ? "bg-[hsl(var(--primary))] text-white"
          : "border border-white/10 bg-black/85 text-white",
        className,
      )}
    >
      {label}
    </span>
  );
}
