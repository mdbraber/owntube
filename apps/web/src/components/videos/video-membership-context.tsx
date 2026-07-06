"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { trpc } from "@/trpc/react";

export type VideoMembership = {
  saved: boolean;
  queued: boolean;
  /** Name of a playlist the video belongs to, if any. */
  playlistName?: string;
};

type VideoMembershipValue = {
  savedIds: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  playlistByVideo: ReadonlyMap<string, string>;
};

const EMPTY: VideoMembershipValue = {
  savedIds: new Set(),
  queuedIds: new Set(),
  playlistByVideo: new Map(),
};

const VideoMembershipContext = createContext<VideoMembershipValue>(EMPTY);

/**
 * Loads the user's saved / queued / playlisted video sets **once per page** and
 * shares them so any video card can render status pills with an O(1) lookup —
 * instead of each card querying membership on its own. All three queries are
 * lightweight (id-only) and gated on an authenticated session; signed-out users
 * hydrate the empty sets and render no pills.
 */
export function VideoMembershipProvider({ children }: { children: ReactNode }) {
  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const savedQuery = trpc.interactions.savedIds.useQuery(undefined, {
    enabled: authed,
  });
  const queueQuery = trpc.queue.list.useQuery(undefined, { enabled: authed });
  const playlistQuery = trpc.playlists.membership.useQuery(undefined, {
    enabled: authed,
  });

  const value = useMemo<VideoMembershipValue>(() => {
    const savedIds = new Set(savedQuery.data ?? []);
    const queuedIds = new Set((queueQuery.data ?? []).map((i) => i.videoId));
    const playlistByVideo = new Map<string, string>();
    // Rows arrive most-recently-added first; keep the first name seen per video.
    for (const row of playlistQuery.data ?? []) {
      if (!playlistByVideo.has(row.videoId)) {
        playlistByVideo.set(row.videoId, row.playlistName);
      }
    }
    return { savedIds, queuedIds, playlistByVideo };
  }, [savedQuery.data, queueQuery.data, playlistQuery.data]);

  return (
    <VideoMembershipContext.Provider value={value}>
      {children}
    </VideoMembershipContext.Provider>
  );
}

export function useVideoMembership(videoId?: string): VideoMembership {
  const { savedIds, queuedIds, playlistByVideo } = useContext(
    VideoMembershipContext,
  );
  return useMemo(() => {
    if (!videoId) return { saved: false, queued: false };
    return {
      saved: savedIds.has(videoId),
      queued: queuedIds.has(videoId),
      playlistName: playlistByVideo.get(videoId),
    };
  }, [videoId, savedIds, queuedIds, playlistByVideo]);
}
