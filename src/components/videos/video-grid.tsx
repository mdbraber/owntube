import { VideoCard, VideoCardShort } from "@/components/videos/video-card";
import type { UnifiedVideo } from "@/server/services/proxy.types";

type VideoGridProps = {
  videos: UnifiedVideo[];
  size?: "default" | "large";
  /** Vertical 9:16 cards in a dense grid (Shorts tab). */
  variant?: "video" | "short";
};

function videoCardProps(v: UnifiedVideo) {
  return {
    href: `/watch/${v.videoId}`,
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
  };
}

export function VideoGrid({
  videos,
  size = "default",
  variant = "video",
}: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <p className="rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
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
    <ul className={gridClass}>
      {videos.map((v) => (
        <li key={v.videoId}>
          <VideoCard {...videoCardProps(v)} />
        </li>
      ))}
    </ul>
  );
}
