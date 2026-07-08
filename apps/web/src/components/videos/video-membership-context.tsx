"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { trpc } from "@/trpc/react";

const EMPTY_ID_SET: ReadonlySet<number> = new Set();

export type VideoMembership = {
  saved: boolean;
  queued: boolean;
  /** Name of a playlist the video belongs to, if any. */
  playlistName?: string;
  /** Id of that playlist — lets the status pill link to it. */
  playlistId?: number;
  /** Every playlist (id) the video belongs to — backs the picker checklist. */
  playlistIds: ReadonlySet<number>;
};

type PlaylistRef = { id: number; name: string };

export type WatchProgress = {
  /** 0–1 of the video watched (resume position over duration). */
  fraction: number;
  completed: boolean;
};

type VideoMembershipValue = {
  savedIds: ReadonlySet<string>;
  queuedIds: ReadonlySet<string>;
  playlistByVideo: ReadonlyMap<string, PlaylistRef>;
  playlistIdsByVideo: ReadonlyMap<string, ReadonlySet<number>>;
  progressByVideo: ReadonlyMap<string, WatchProgress>;
};

const EMPTY: VideoMembershipValue = {
  savedIds: new Set(),
  queuedIds: new Set(),
  playlistByVideo: new Map(),
  playlistIdsByVideo: new Map(),
  progressByVideo: new Map(),
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
  const progressQuery = trpc.history.progressAll.useQuery(undefined, {
    enabled: authed,
  });

  const value = useMemo<VideoMembershipValue>(() => {
    const savedIds = new Set(savedQuery.data ?? []);
    const queuedIds = new Set((queueQuery.data ?? []).map((i) => i.videoId));
    const playlistByVideo = new Map<string, PlaylistRef>();
    const playlistIdsByVideo = new Map<string, Set<number>>();
    // Rows arrive most-recently-added first; keep the first name seen per video.
    for (const row of playlistQuery.data ?? []) {
      if (!playlistByVideo.has(row.videoId)) {
        playlistByVideo.set(row.videoId, {
          id: row.playlistId,
          name: row.playlistName,
        });
      }
      const ids = playlistIdsByVideo.get(row.videoId) ?? new Set<number>();
      ids.add(row.playlistId);
      playlistIdsByVideo.set(row.videoId, ids);
    }
    // Newest history row per video wins (rows arrive newest first).
    const progressByVideo = new Map<string, WatchProgress>();
    for (const row of progressQuery.data ?? []) {
      if (progressByVideo.has(row.videoId)) continue;
      const pos =
        row.positionSeconds > 0 ? row.positionSeconds : row.durationWatched;
      const fraction =
        row.videoDurationSeconds > 0
          ? Math.max(0, Math.min(1, pos / row.videoDurationSeconds))
          : 0;
      progressByVideo.set(row.videoId, {
        fraction,
        completed: Boolean(row.completed),
      });
    }
    return {
      savedIds,
      queuedIds,
      playlistByVideo,
      playlistIdsByVideo,
      progressByVideo,
    };
  }, [
    savedQuery.data,
    queueQuery.data,
    playlistQuery.data,
    progressQuery.data,
  ]);

  return (
    <VideoMembershipContext.Provider value={value}>
      {children}
    </VideoMembershipContext.Provider>
  );
}

export function useVideoMembership(videoId?: string): VideoMembership {
  const { savedIds, queuedIds, playlistByVideo, playlistIdsByVideo } =
    useContext(VideoMembershipContext);
  return useMemo(() => {
    if (!videoId) {
      return { saved: false, queued: false, playlistIds: EMPTY_ID_SET };
    }
    const playlist = playlistByVideo.get(videoId);
    return {
      saved: savedIds.has(videoId),
      queued: queuedIds.has(videoId),
      playlistName: playlist?.name,
      playlistId: playlist?.id,
      playlistIds: playlistIdsByVideo.get(videoId) ?? EMPTY_ID_SET,
    };
  }, [videoId, savedIds, queuedIds, playlistByVideo, playlistIdsByVideo]);
}

/** Watch progress for one video from the shared page-level map. */
export function useWatchProgress(videoId?: string): WatchProgress | null {
  const { progressByVideo } = useContext(VideoMembershipContext);
  if (!videoId) return null;
  return progressByVideo.get(videoId) ?? null;
}
