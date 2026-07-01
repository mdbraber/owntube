import { cn } from "@/lib/utils";
import {
  formatThumbnailBadge,
  type ThumbnailBadgeInput,
} from "@/lib/video-display";

type VideoCardDurationBadgeProps = ThumbnailBadgeInput & {
  className?: string;
};

export function VideoCardDurationBadge({
  className,
  isLive,
  isUpcoming,
  ...input
}: VideoCardDurationBadgeProps) {
  if (isLive && !isUpcoming) {
    return (
      <span
        className={cn(
          "ot-video-duration-badge pointer-events-none absolute bottom-2 right-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ot-brand-gradient shadow-sm",
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
        "ot-video-duration-badge pointer-events-none absolute rounded-md font-mono font-semibold tabular-nums backdrop-blur-sm",
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
