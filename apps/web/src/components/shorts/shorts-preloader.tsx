"use client";

import { trpc } from "@/trpc/react";

/**
 * Warm the next short: its video page (with signed playback URLs) is fetched
 * ahead of the swipe, so the slide mounts its player without a round trip.
 * Media is not pre-fetched: every manifest request starts its own playback
 * session at the gateway, so bytes fetched here would not be the player's.
 * Only mounted when the user's "preload next short" setting is on.
 */
export function ShortsPreloader({ videoId }: { videoId: string }) {
  trpc.video.detail.useQuery({ videoId }, { staleTime: 60_000 });
  return null;
}
