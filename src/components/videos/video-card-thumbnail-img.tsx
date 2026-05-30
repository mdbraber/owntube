"use client";

import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";

type VideoCardThumbnailImgProps = {
  url?: string;
  videoId?: string;
  className: string;
};

export function VideoCardThumbnailImg({
  url,
  videoId,
  className,
}: VideoCardThumbnailImgProps) {
  return (
    <VideoThumbnailImg url={url} videoId={videoId} className={className} />
  );
}
