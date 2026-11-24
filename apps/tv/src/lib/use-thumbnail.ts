import { useState } from "react";
import { stillUrl, videoThumbnailUrl } from "@/lib/format";

/**
 * Width asked of the server's card thumbnails (`/image/…?w=`): a 16:9 crop,
 * where YouTube's 480x360 still is 4:3 with black bars the card crops away
 * but the TV still decodes. Near a 264dp card's 528px at 2x density.
 */
const CARD_THUMBNAIL_WIDTH = 480;

/**
 * YouTube's 11-character video ID. Cards also carry playlists, whose "video
 * ID" is a playlist ID (a local number, or "PL…"), and YouTube has no still
 * for those.
 */
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A card's thumbnail with a fallback, all from this instance (see `stillUrl`).
 * The cropped still first; if it fails to load (the crop can't be made, a
 * dropped request), `onError` steps to the row's own still. Smaller stills
 * needn't be listed: the instance already answers a missing still with the
 * next one down. `uri` is undefined when there is nothing to load, and the
 * card keeps its placeholder.
 */
export function useThumbnail(video: {
  videoId: string;
  thumbnailUrl?: string;
}) {
  const isVideo = YOUTUBE_VIDEO_ID.test(video.videoId);
  const candidates = [
    ...(isVideo
      ? [
          `${stillUrl(video.videoId, "hqdefault.jpg")}?w=${CARD_THUMBNAIL_WIDTH}`,
        ]
      : []),
    ...(video.thumbnailUrl || isVideo ? [videoThumbnailUrl(video)] : []),
  ].filter((url, i, all) => all.indexOf(url) === i);
  // Keyed by video so a recycled card starts over at the first candidate.
  const [failed, setFailed] = useState({ videoId: video.videoId, count: 0 });
  const count = failed.videoId === video.videoId ? failed.count : 0;
  // Out of candidates: stop, rather than retrying the last one forever.
  const uri: string | undefined = candidates[count];
  const onError = () => setFailed({ videoId: video.videoId, count: count + 1 });
  return { uri, onError };
}
