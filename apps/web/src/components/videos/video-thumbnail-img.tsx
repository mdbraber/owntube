"use client";

import { useInvidiousOrigins } from "@/components/videos/invidious-origin-context";
import { toBrowserUpstreamImageUrl } from "@/lib/channel-avatar-proxy";
import {
  applyVideoThumbnailImgError,
  preferHeroVideoThumbnailUrl,
  preferHighResVideoThumbnailUrl,
  preferShortVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";

type VideoThumbnailImgProps = {
  url?: string;
  videoId?: string;
  className: string;
  loading?: "lazy" | "eager";
  alt?: string;
  /** Vertical Shorts cards — prefer OAR stills and portrait fallbacks. */
  variant?: "default" | "short" | "hero";
};

function resolveTieredThumbnailUrl(
  url: string | undefined,
  videoId: string | undefined,
  variant: VideoThumbnailImgProps["variant"],
): string | undefined {
  if (variant === "short") {
    return preferShortVideoThumbnailUrl(
      preferHighResVideoThumbnailUrl(url, videoId),
      videoId,
    );
  }
  if (variant === "hero") {
    return preferHeroVideoThumbnailUrl(url, videoId);
  }
  return preferHighResVideoThumbnailUrl(url, videoId);
}

export function VideoThumbnailImg({
  url,
  videoId,
  className,
  loading = "lazy",
  alt = "",
  variant = "default",
}: VideoThumbnailImgProps) {
  const invidiousOrigins = useInvidiousOrigins();
  const src = toBrowserUpstreamImageUrl(
    resolveTieredThumbnailUrl(url, videoId, variant),
    invidiousOrigins,
  );
  if (!src) return null;
  return (
    // biome-ignore lint/performance/noImgElement: third-party instance thumbnails
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      data-thumbnail-variant={variant === "short" ? "short" : undefined}
      onError={(e) => applyVideoThumbnailImgError(e.currentTarget)}
    />
  );
}
