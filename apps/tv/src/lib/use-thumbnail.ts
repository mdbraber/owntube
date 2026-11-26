import { useState } from "react";
import { stillUrl, videoThumbnailUrl } from "@/lib/format";

/**
 * YouTube's 11-character video ID. Cards also carry playlists, whose "video
 * ID" is a playlist ID (a local number, or "PL…"), and YouTube has no still
 * for those.
 */
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A card's thumbnail with a fallback, all from this instance (see `stillUrl`).
 * The `hqdefault` still first (it exists for every video; the card's "cover"
 * crop hides its letterbox bars); if it fails to load, `onError` steps to the
 * row's own still. `uri` is undefined when there is nothing to load, and the
 * card keeps its placeholder.
 */
export function useThumbnail(video: {
  videoId: string;
  thumbnailUrl?: string;
}) {
  const isVideo = YOUTUBE_VIDEO_ID.test(video.videoId);
  const candidates = [
    ...(isVideo ? [stillUrl(video.videoId, "hqdefault.jpg")] : []),
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
