import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { watchHref } from "@/lib/yt-routes";
import { VideoCard, VideoCardShort } from "@/components/videos/video-card";
import type { UnifiedVideo } from "@/server/services/proxy.types";

type VideoGridProps = {
  videos: UnifiedVideo[];
  size?: "default" | "large";
  /** Vertical 9:16 cards in a dense grid (Shorts tab). */
  variant?: "video" | "short";
  /** Ids to dim in place (e.g. ignored videos on a channel page). */
  dimVideoIds?: ReadonlySet<string>;
  /** Enable mobile swipe gestures (Home/Explore/Subscriptions only). */
  enableSwipe?: boolean;
  /**
   * Override the auto-fill grid's minimum column width (home block sizes) —
   * column count stays responsive, only the floor changes.
   */
  minColumnWidthPx?: number;
  /** Card surface (pills omission + menu trimming). */
  surface?: VideoActionSurface;
};

function videoCardProps(v: UnifiedVideo) {
  return {
    href: watchHref(v.videoId),
    videoId: v.videoId,
    title: v.title,
    channelId: v.channelId,
    channelName: v.channelName,
    channelHref: v.channelId
      ? `/channel/${encodeURIComponent(v.channelId)}`
      : undefined,
    channelAvatarUrl: v.channelAvatarUrl,
    thumbnailUrl: v.thumbnailUrl,
    durationSeconds: v.durationSeconds,
    isLive: v.isLive,
    isUpcoming: v.isUpcoming,
    viewCount: v.viewCount,
    publishedText: v.publishedText,
    publishedAt: v.publishedAt,
    recommendationReason: v.recommendationReason,
  };
}

export function VideoGrid({
  videos,
  size = "default",
  variant = "video",
  dimVideoIds,
  enableSwipe,
  minColumnWidthPx,
  surface,
}: VideoGridProps) {
  const gridStyle = minColumnWidthPx
    ? {
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColumnWidthPx}px), 1fr))`,
      }
    : undefined;
  if (videos.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No videos.
      </p>
    );
  }

  if (variant === "short") {
    return (
      <ul className="ot-video-grid ot-video-grid--short">
        {videos.map((v) => (
          <li key={v.videoId} className="w-full max-w-[210px]">
            <VideoCardShort {...videoCardProps(v)} />
          </li>
        ))}
      </ul>
    );
  }

  const gridClass =
    size === "large" ? "ot-video-grid ot-video-grid--large" : "ot-video-grid";
  return (
    <ul className={gridClass} style={gridStyle}>
      {videos.map((v) => (
        <li key={v.videoId}>
          <VideoCard
            {...videoCardProps(v)}
            dimmed={dimVideoIds?.has(v.videoId) ?? false}
            enableSwipe={enableSwipe}
            surface={surface}
          />
        </li>
      ))}
    </ul>
  );
}
