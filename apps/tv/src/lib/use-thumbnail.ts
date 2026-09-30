import { useState } from "react";
import { baseUrl } from "@/lib/config";
import { videoThumbnailUrl, viaInstance } from "@/lib/format";

/**
 * Width asked of the server's card thumbnails (`/image/…?w=`): a 16:9 crop,
 * where YouTube's 480x360 still is 4:3 with black bars the card crops away
 * but the TV still decodes. Near a 264dp card's 528px at 2x density.
 */
const CARD_THUMBNAIL_WIDTH = 480;

/**
 * YouTube's 11-character video ID. Cards also carry playlists, whose "video
 * ID" is a playlist ID (a local number, or "PL…"), and i.ytimg.com has no
 * still for those.
 */
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A card's thumbnail with fallbacks. A still can fail to load (an expired or
 * proxied link, a dropped request), and the image would stay blank; `onError`
 * steps to YouTube's own stills instead, the smaller one last — each through
 * this instance (`viaInstance`), never from YouTube directly. `uri` is
 * undefined when there is nothing to load, and the card keeps its placeholder.
 */
export function useThumbnail(video: {
  videoId: string;
  thumbnailUrl?: string;
}) {
  const id = encodeURIComponent(video.videoId);
  const isVideo = YOUTUBE_VIDEO_ID.test(video.videoId);
  const candidates = [
    // The server's cropped still first; the feed's own URL if that fails.
    ...(isVideo
      ? [`${baseUrl()}/image/vi/${id}/hqdefault.jpg?w=${CARD_THUMBNAIL_WIDTH}`]
      : []),
    ...(video.thumbnailUrl || isVideo ? [videoThumbnailUrl(video)] : []),
    ...(isVideo
      ? [
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        ]
      : []),
  ]
    .map(viaInstance)
    .filter((url, i, all) => all.indexOf(url) === i);
  // Keyed by video so a recycled card starts over at the first candidate.
  const [failed, setFailed] = useState({ videoId: video.videoId, count: 0 });
  const count = failed.videoId === video.videoId ? failed.count : 0;
  // Out of candidates: stop, rather than retrying the last one forever.
  const uri: string | undefined = candidates[count];
  const onError = () => setFailed({ videoId: video.videoId, count: count + 1 });
  return { uri, onError };
}
