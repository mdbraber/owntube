"use client";

import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AppRouter } from "@/server/trpc/root";
import { trpc } from "@/trpc/react";

type HomeFeedPage = inferRouterOutputs<AppRouter>["feed"]["home"];

export type VideoCardActionsView = "main" | "playlist" | "create-playlist";

export function useVideoCardActions({
  videoId,
  channelId,
  channelName,
  loadPlaylists = false,
}: {
  videoId: string;
  channelId?: string;
  channelName?: string;
  loadPlaylists?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<VideoCardActionsView>("main");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const interactionState = trpc.interactions.state.useQuery({ videoId });
  const playlists = trpc.playlists.list.useQuery(undefined, {
    enabled: loadPlaylists || (playlistOpen && view !== "main"),
  });
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: Boolean(channelId),
  });

  const setInteraction = trpc.interactions.set.useMutation({
    onSuccess: async () => {
      // The home feed is patched optimistically per-action below; refetching it
      // here would resurface a freshly hidden card before the server pool clears.
      await Promise.all([
        utils.interactions.state.invalidate({ videoId }),
        utils.interactions.savedIds.invalidate(),
        utils.video.related.invalidate(),
        utils.shorts.feed.invalidate(),
      ]);
    },
  });
  const addToPlaylist = trpc.playlists.addItem.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.playlists.list.invalidate(),
        utils.playlists.membership.invalidate(),
      ]);
    },
  });
  const createPlaylist = trpc.playlists.create.useMutation({
    onSuccess: async () => {
      await utils.playlists.list.invalidate();
    },
  });
  const blockChannel = trpc.interactions.blockRecommendationChannel.useMutation(
    {
      onSuccess: async () => {
        await Promise.all([
          utils.settings.get.invalidate(),
          utils.video.related.invalidate(),
          utils.shorts.feed.invalidate(),
        ]);
      },
    },
  );

  /** Patches every cached home-feed page, dropping rows that match the predicate. */
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

  const removeVideoFromFeed = useCallback(
    (id: string) => patchHomeFeed((v) => v.videoId !== id),
    [patchHomeFeed],
  );

  const removeChannelFromFeed = useCallback(
    (id: string) => patchHomeFeed((v) => v.channelId !== id),
    [patchHomeFeed],
  );

  const liked = interactionState.data?.like ?? false;
  const disliked = interactionState.data?.dislike ?? false;
  const channelBlocked =
    channelId != null &&
    (settings.data?.blockedRecommendationChannels.includes(channelId) ?? false);
  const pending =
    setInteraction.isPending ||
    addToPlaylist.isPending ||
    createPlaylist.isPending ||
    blockChannel.isPending;

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const redirectToLogin = () => {
    router.push(
      `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`,
    );
  };

  const runAuthed = async (fn: () => Promise<void>) => {
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
  };

  const closePanels = () => {
    setPlaylistOpen(false);
    setView("main");
    setFeedback(null);
  };

  const toggleLike = async () => {
    const next = !liked;
    await runAuthed(async () => {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type: "like",
        active: next,
      });
      if (next && disliked) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: "dislike",
          active: false,
        });
      }
      await utils.feed.home.invalidate();
      setFeedback(next ? "Added to liked" : "Like removed");
    });
  };

  const toggleDislike = async () => {
    const next = !disliked;
    await runAuthed(async () => {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type: "dislike",
        active: next,
      });
      if (next && liked) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: "like",
          active: false,
        });
      }
      if (next) {
        // Hide the disliked card immediately; the server pool already excludes it.
        removeVideoFromFeed(videoId);
      } else {
        // Un-disliked: let the feed refetch so the video can surface again.
        await utils.feed.home.invalidate();
      }
      setFeedback(next ? "Marked as not interested" : "Dislike removed");
    });
  };

  const addVideoToPlaylist = async (playlistId: number) => {
    await runAuthed(async () => {
      await addToPlaylist.mutateAsync({ playlistId, videoId, channelId });
      setFeedback("Added to playlist");
      closePanels();
    });
  };

  const submitNewPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    await runAuthed(async () => {
      const created = await createPlaylist.mutateAsync({ name });
      await addToPlaylist.mutateAsync({
        playlistId: created.id,
        videoId,
        channelId,
      });
      setNewPlaylistName("");
      setFeedback("Playlist created and video added");
      closePanels();
    });
  };

  const blockRecommendationChannel = async () => {
    if (!channelId) return;
    await runAuthed(async () => {
      await blockChannel.mutateAsync({ channelId });
      // Drop every card from this channel right away (server already excludes it).
      removeChannelFromFeed(channelId);
      setFeedback(
        channelName
          ? `"${channelName}" excluded from recommendations`
          : "Channel excluded from recommendations",
      );
      closePanels();
    });
  };

  return {
    liked,
    disliked,
    channelBlocked,
    pending,
    feedback,
    view,
    setView,
    newPlaylistName,
    setNewPlaylistName,
    playlistOpen,
    setPlaylistOpen,
    playlists,
    toggleLike,
    toggleDislike,
    addVideoToPlaylist,
    submitNewPlaylist,
    blockRecommendationChannel,
    closePanels,
  };
}
