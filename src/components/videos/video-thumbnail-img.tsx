"use client";

import {
  applyVideoThumbnailImgError,
  preferHighResVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";

type VideoThumbnailImgProps = {
  url?: string;
  videoId?: string;
  className: string;
  loading?: "lazy" | "eager";
  alt?: string;
};

export function VideoThumbnailImg({
  url,
  videoId,
  className,
  loading = "lazy",
  alt = "",
}: VideoThumbnailImgProps) {
  const src = preferHighResVideoThumbnailUrl(url, videoId);
  if (!src) return null;
  return (
    // biome-ignore lint/performance/noImgElement: third-party instance thumbnails
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={(e) => applyVideoThumbnailImgError(e.currentTarget)}
    />
  );
}
