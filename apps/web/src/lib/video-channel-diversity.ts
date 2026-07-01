import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * Reorders videos so a single channel does not dominate a short list (e.g. the
 * home Shorts shelf): round-robins across channels in first-seen order and caps
 * how many items each channel contributes. Videos without a channel id are each
 * treated as their own channel so they are never merged together.
 */
export function diversifyVideosByChannel(
  videos: readonly UnifiedVideo[],
  maxPerChannel: number,
): UnifiedVideo[] {
  if (maxPerChannel < 1) return [];

  const order: string[] = [];
  const queues = new Map<string, UnifiedVideo[]>();
  for (const video of videos) {
    const key = video.channelId?.trim()
      ? `id:${video.channelId.trim()}`
      : `video:${video.videoId}`;
    let queue = queues.get(key);
    if (!queue) {
      queue = [];
      queues.set(key, queue);
      order.push(key);
    }
    queue.push(video);
  }

  const out: UnifiedVideo[] = [];
  for (let round = 0; round < maxPerChannel; round++) {
    for (const key of order) {
      const queue = queues.get(key);
      const next = queue?.[round];
      if (next) out.push(next);
    }
  }
  return out;
}
