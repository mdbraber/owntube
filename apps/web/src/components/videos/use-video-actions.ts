"use client";

import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { usePlayerContext } from "@/components/player/player-context";
import { useActionToast } from "@/components/videos/action-toast";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import {
  isVideoActionActive,
  type VideoActionId,
  type VideoActionState,
  type VideoActionSurface,
  videoActionLabel,
} from "@/components/videos/video-action-registry";
import { useVideoMembership } from "@/components/videos/video-membership-context";
import type { AppRouter } from "@/server/trpc/root";
import { trpc } from "@/trpc/react";

type HomeFeedPage = inferRouterOutputs<AppRouter>["feed"]["home"];

export type UseVideoActionsArgs = {
  videoId: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  /** Trims the action list per context (defaults to a generic feed). */
  surface?: VideoActionSurface;
  /**
   * Load per-video like/dislike + blocked-channel state from the server.
   * Enable only where that state is visible (open menu, watch page, shorts
   * rail) — grids of collapsed cards should not fan out N state queries.
   */
  withInteractionState?: boolean;
  /** Load the user's playlists (for the picker view). */
  loadPlaylists?: boolean;
};

/**
 * The single hook behind every video action surface — cards, rows, menus,
 * sheets, swipe gestures, shorts rail, and the watch page. Server state comes
 * from the shared membership context (saved/queued/playlists, one query per
 * page) plus an optional per-video interactions query; every mutation applies
 * optimistically and reports through the global action toast with Undo where
 * an inverse exists.
 */
export function useVideoActions({
  videoId,
  channelId,
  channelName,
  title,
  surface = "feed",
  withInteractionState = false,
  loadPlaylists = false,
}: UseVideoActionsArgs) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { active: activePlayer } = usePlayerContext();
  const { showToast } = useActionToast();
  const { ignore, unignore } = useIgnoredVideos();
  const membership = useVideoMembership(videoId);

  // Optimistic overrides so a click reflects instantly before queries settle.
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null);
  const [queuedOverride, setQueuedOverride] = useState<boolean | null>(null);
  const [watched, setWatched] = useState(false);
  const [likedOverride, setLikedOverride] = useState<boolean | null>(null);
  const [dislikedOverride, setDislikedOverride] = useState<boolean | null>(
    null,
  );

  const interactionState = trpc.interactions.state.useQuery(
    { videoId },
    { enabled: withInteractionState },
  );
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: withInteractionState && Boolean(channelId),
  });
  const playlists = trpc.playlists.list.useQuery(undefined, {
    enabled: loadPlaylists,
  });

  const state: VideoActionState = {
    saved: savedOverride ?? membership.saved,
    queued: queuedOverride ?? membership.queued,
    liked: likedOverride ?? interactionState.data?.like ?? false,
    disliked: dislikedOverride ?? interactionState.data?.dislike ?? false,
    watched,
    channelBlocked:
      channelId != null &&
      (settings.data?.blockedRecommendationChannels.includes(channelId) ??
        false),
  };

  /* ------------------------------ mutations ------------------------------ */

  const setInteraction = trpc.interactions.set.useMutation({
    onSettled: () => {
      setLikedOverride(null);
      setDislikedOverride(null);
      return Promise.all([
        utils.interactions.state.invalidate({ videoId }),
        utils.interactions.savedIds.invalidate(),
      ]);
    },
  });
  const saveMutation = trpc.interactions.set.useMutation({
    onSettled: () => {
      setSavedOverride(null);
      return Promise.all([
        utils.interactions.savedIds.invalidate(),
        utils.interactions.state.invalidate({ videoId }),
      ]);
    },
  });
  const queueAdd = trpc.queue.add.useMutation({
    onSettled: () => {
      setQueuedOverride(null);
      return Promise.all([
        utils.queue.list.invalidate(),
        utils.queue.listDetailed.invalidate(),
      ]);
    },
  });
  const queueRemove = trpc.queue.remove.useMutation({
    onSettled: () => {
      setQueuedOverride(null);
      return Promise.all([
        utils.queue.list.invalidate(),
        utils.queue.listDetailed.invalidate(),
      ]);
    },
  });
  const markWatchedMutation = trpc.subscriptions.markWatched.useMutation({
    onMutate: async (vars) => {
      // Optimistic: flip the shared progress map so hide-finished sections
      // drop the video immediately.
      await utils.history.progressAll.cancel();
      const prev = utils.history.progressAll.getData();
      utils.history.progressAll.setData(undefined, (old) => [
        {
          videoId: vars.videoId,
          positionSeconds: 0,
          durationWatched: 0,
          videoDurationSeconds: 1,
          completed: 1,
        },
        ...(old ?? []),
      ]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.history.progressAll.setData(undefined, ctx.prev);
    },
    onSuccess: () =>
      Promise.all([
        utils.subscriptions.mergedFeedInfinite.invalidate(),
        utils.feed.home.invalidate(),
        utils.video.related.invalidate(),
        utils.history.list.invalidate(),
      ]),
    onSettled: () => utils.history.progressAll.invalidate(),
  });
  const blockChannelMutation =
    trpc.interactions.blockRecommendationChannel.useMutation({
      onSuccess: () =>
        Promise.all([
          utils.settings.get.invalidate(),
          utils.video.related.invalidate(),
          utils.shorts.feed.invalidate(),
        ]),
    });
  const unblockChannelMutation =
    trpc.interactions.unblockRecommendationChannel.useMutation({
      onSuccess: () =>
        Promise.all([
          utils.settings.get.invalidate(),
          utils.video.related.invalidate(),
          utils.shorts.feed.invalidate(),
          utils.feed.home.invalidate(),
        ]),
    });
  const addToPlaylist = trpc.playlists.addItem.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.playlists.list.invalidate(),
        utils.playlists.membership.invalidate(),
      ]),
  });
  const removeFromPlaylist = trpc.playlists.removeItem.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.playlists.list.invalidate(),
        utils.playlists.membership.invalidate(),
      ]),
  });
  const createPlaylist = trpc.playlists.create.useMutation({
    onSuccess: () => utils.playlists.list.invalidate(),
  });

  const pending =
    setInteraction.isPending ||
    markWatchedMutation.isPending ||
    blockChannelMutation.isPending ||
    addToPlaylist.isPending ||
    removeFromPlaylist.isPending ||
    createPlaylist.isPending;

  /* ------------------------------- helpers ------------------------------- */

  /** Patches every cached home-feed page, dropping rows that match. */
  const patchHomeFeed = useCallback(
    (keep: (video: HomeFeedPage["videos"][number]) => boolean) => {
      queryClient.setQueriesData<InfiniteData<HomeFeedPage>>(
        { queryKey: getQueryKey(trpc.feed.home, undefined, "infinite") },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              videos: page.videos.filter(keep),
            })),
          };
        },
      );
    },
    [queryClient],
  );

  const redirectToLogin = useCallback(() => {
    router.push(
      `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`,
    );
  }, [router]);

  const runAuthed = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        const code =
          err &&
          typeof err === "object" &&
          "data" in err &&
          err.data &&
          typeof err.data === "object" &&
          "code" in err.data
            ? String(err.data.code)
            : "";
        if (code === "UNAUTHORIZED") {
          redirectToLogin();
          return;
        }
        throw err;
      }
    },
    [redirectToLogin],
  );

  /* ------------------------------- actions ------------------------------- */

  const toggleQueue = useCallback(
    (next?: boolean) => {
      const target = next ?? !(queuedOverride ?? membership.queued);
      setQueuedOverride(target);
      if (target) {
        queueAdd.mutate({ videoId, title: title ?? videoId, channelId });
        showToast("Added to queue", {
          undo: () => toggleQueueRef.current(false),
        });
      } else {
        queueRemove.mutate({ videoId });
        showToast("Removed from queue", {
          undo: () => toggleQueueRef.current(true),
        });
      }
    },
    [
      queuedOverride,
      membership.queued,
      queueAdd,
      queueRemove,
      videoId,
      title,
      channelId,
      showToast,
    ],
  );
  const toggleQueueRef = useRef(toggleQueue);
  toggleQueueRef.current = toggleQueue;

  const toggleSave = useCallback(
    (next?: boolean) => {
      const target = next ?? !(savedOverride ?? membership.saved);
      setSavedOverride(target);
      void runAuthed(async () => {
        await saveMutation.mutateAsync({
          videoId,
          channelId,
          type: "save",
          active: target,
          title,
        });
      });
      showToast(target ? "Saved" : "Removed from saved", {
        undo: () => toggleSaveRef.current(!target),
      });
    },
    [
      savedOverride,
      membership.saved,
      saveMutation,
      runAuthed,
      videoId,
      channelId,
      title,
      showToast,
    ],
  );
  const toggleSaveRef = useRef(toggleSave);
  toggleSaveRef.current = toggleSave;

  const toggleLike = useCallback(async () => {
    const next = !state.liked;
    setLikedOverride(next);
    if (next && state.disliked) setDislikedOverride(false);
    await runAuthed(async () => {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type: "like",
        active: next,
      });
      if (next && state.disliked) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: "dislike",
          active: false,
        });
      }
      await utils.feed.home.invalidate();
      showToast(next ? "Liked" : "Like removed");
    });
  }, [
    state.liked,
    state.disliked,
    runAuthed,
    setInteraction,
    videoId,
    channelId,
    utils.feed.home,
    showToast,
  ]);

  const toggleDislike = useCallback(async () => {
    const next = !state.disliked;
    setDislikedOverride(next);
    if (next && state.liked) setLikedOverride(false);
    await runAuthed(async () => {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type: "dislike",
        active: next,
      });
      if (next && state.liked) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: "like",
          active: false,
        });
      }
      if (next) {
        // Hide the disliked card immediately; the server pool excludes it.
        patchHomeFeed((v) => v.videoId !== videoId);
        showToast("Marked as not interested", {
          undo: () => void toggleDislikeRef.current(),
        });
      } else {
        // Un-disliked: let the feed refetch so the video can surface again.
        await utils.feed.home.invalidate();
        showToast("Dislike removed");
      }
    });
  }, [
    state.disliked,
    state.liked,
    runAuthed,
    setInteraction,
    videoId,
    channelId,
    patchHomeFeed,
    utils.feed.home,
    showToast,
  ]);
  const toggleDislikeRef = useRef(toggleDislike);
  toggleDislikeRef.current = toggleDislike;

  const markWatched = useCallback(async () => {
    if (watched || markWatchedMutation.isPending) return;
    setWatched(true);
    // Watched means done — stop the video wherever it is playing: the
    // persistent player (watch page / mini) and any hover preview of it.
    if (activePlayer?.props.videoId === videoId) {
      document
        .querySelector<HTMLVideoElement>("[data-ot-player-root] video")
        ?.pause();
    }
    for (const el of document.querySelectorAll<HTMLVideoElement>(
      `video[data-ot-preview="${CSS.escape(videoId)}"]`,
    )) {
      el.pause();
    }
    try {
      await runAuthed(async () => {
        await markWatchedMutation.mutateAsync({ videoId, channelId });
        showToast("Marked as watched");
      });
    } catch {
      setWatched(false);
    }
  }, [
    watched,
    markWatchedMutation,
    runAuthed,
    videoId,
    channelId,
    showToast,
    activePlayer,
  ]);

  const ignoreVideo = useCallback(() => {
    ignore(videoId, channelId);
    showToast("Video hidden from feeds", {
      undo: () => unignore(videoId, channelId),
    });
  }, [ignore, unignore, videoId, channelId, showToast]);

  const blockChannel = useCallback(async () => {
    if (!channelId) return;
    await runAuthed(async () => {
      await blockChannelMutation.mutateAsync({ channelId });
      patchHomeFeed((v) => v.channelId !== channelId);
      showToast(
        channelName
          ? `"${channelName}" excluded from recommendations`
          : "Channel excluded from recommendations",
        {
          undo: () => {
            unblockChannelMutation.mutate({ channelId });
          },
        },
      );
    });
  }, [
    channelId,
    channelName,
    runAuthed,
    blockChannelMutation,
    unblockChannelMutation,
    patchHomeFeed,
    showToast,
  ]);

  const togglePlaylist = useCallback(
    async (playlistId: number, playlistName: string) => {
      const isIn = membership.playlistIds.has(playlistId);
      await runAuthed(async () => {
        if (isIn) {
          await removeFromPlaylist.mutateAsync({ playlistId, videoId });
          showToast(`Removed from "${playlistName}"`);
        } else {
          await addToPlaylist.mutateAsync({ playlistId, videoId, channelId });
          showToast(`Added to "${playlistName}"`);
        }
      });
    },
    [
      membership.playlistIds,
      runAuthed,
      removeFromPlaylist,
      addToPlaylist,
      videoId,
      channelId,
      showToast,
    ],
  );

  const createPlaylistAndAdd = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await runAuthed(async () => {
        const created = await createPlaylist.mutateAsync({ name: trimmed });
        await addToPlaylist.mutateAsync({
          playlistId: created.id,
          videoId,
          channelId,
        });
        showToast(`Added to "${trimmed}"`);
      });
    },
    [runAuthed, createPlaylist, addToPlaylist, videoId, channelId, showToast],
  );

  /** Dispatch by registry id — lets list surfaces render generically. */
  const runAction = useCallback(
    (id: Exclude<VideoActionId, "playlist">) => {
      switch (id) {
        case "queue":
          return toggleQueue();
        case "save":
          return toggleSave();
        case "like":
          return void toggleLike();
        case "dislike":
          return void toggleDislike();
        case "watched":
          return void markWatched();
        case "ignore":
          return ignoreVideo();
        case "block-channel":
          return void blockChannel();
      }
    },
    [
      toggleQueue,
      toggleSave,
      toggleLike,
      toggleDislike,
      markWatched,
      ignoreVideo,
      blockChannel,
    ],
  );

  // Plain closures — `state` is rebuilt every render anyway.
  const isActive = (id: VideoActionId) => isVideoActionActive(id, state);
  const labelFor = (id: VideoActionId) => videoActionLabel(id, state, surface);

  return {
    surface,
    state,
    pending,
    playlists,
    playlistIds: membership.playlistIds,
    playlistName: membership.playlistName,
    toggleQueue,
    toggleSave,
    toggleLike,
    toggleDislike,
    markWatched,
    ignoreVideo,
    blockChannel,
    togglePlaylist,
    createPlaylistAndAdd,
    runAction,
    isActive,
    labelFor,
  };
}

export type VideoActions = ReturnType<typeof useVideoActions>;
