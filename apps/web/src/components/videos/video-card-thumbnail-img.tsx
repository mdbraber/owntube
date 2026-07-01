"use client";

import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";

type VideoCardThumbnailImgProps = {
  url?: string;
  videoId?: string;
  className: string;
  variant?: "default" | "short";
};

export function VideoCardThumbnailImg({
  url,
  videoId,
  className,
  variant = "default",
}: VideoCardThumbnailImgProps) {
  return (
    <VideoThumbnailImg
      url={url}
      videoId={videoId}
      className={className}
      variant={variant}
    />
  );
}
