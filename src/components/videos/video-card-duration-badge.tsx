import { cn } from "@/lib/utils";
import {
  formatThumbnailBadge,
  type ThumbnailBadgeInput,
  thumbnailBadgeIsLiveAccent,
} from "@/lib/video-display";

type VideoCardDurationBadgeProps = ThumbnailBadgeInput & {
  className?: string;
};

export function VideoCardDurationBadge({
  className,
  ...input
}: VideoCardDurationBadgeProps) {
  const label = formatThumbnailBadge(input);
  if (!label) return null;
  const liveAccent = thumbnailBadgeIsLiveAccent(label);
  return (
    <span
      className={cn(
        "pointer-events-none absolute rounded-md font-mono font-semibold tabular-nums backdrop-blur-sm",
        liveAccent
          ? "bg-[hsl(var(--primary))] text-white"
          : "border border-white/10 bg-black/85 text-white",
        className,
      )}
    >
      {label}
    </span>
  );
}
