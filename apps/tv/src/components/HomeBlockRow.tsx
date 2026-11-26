import type { inferRouterOutputs } from "@trpc/server";
import {
  blockFeedFilter,
  homeBlockTitle,
  isSubscriptionFeedBlock,
} from "@web/lib/home-blocks";
import type { UnifiedVideo } from "@web/server/catalog/types";
import type { AppRouter } from "@web/server/trpc/root";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { SkeletonRows } from "@/components/Skeleton";
import { VideoRow } from "@/components/VideoRow";
import { errorMessage } from "@/lib/error-message";
import { stillUrl } from "@/lib/format";
import type { Nav, PlayContext } from "@/lib/navigation";
import { playAllStart } from "@/lib/play-all";
import {
  useKeptQueryOptions,
  useRefetchStaleOnShow,
} from "@/lib/screen-active";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { createStyles } from "@/lib/ui-scale";
import { useProgressLookup } from "@/lib/watch-progress";
import { colors, fontSize } from "@/theme";

export type HomeBlock =
  inferRouterOutputs<AppRouter>["settings"]["get"]["homeBlocks"][number];

/** Videos per row: a TV row scrolls sideways, so rows/size don't apply. */
const ROW_VIDEOS = 24;

/** Row headings per block type; a "playlist" block shows its playlist's name. */
export const HOME_BLOCK_TITLES: Record<HomeBlock["type"], string> = {
  subscriptions: "Subscriptions",
  favorites: "Favorites",
  tag: "Tag",
  recommended: "Recommended",
  explore: "Live",
  history: "History",
  queue: "Queue",
  saved: "Saved",
  playlists: "Playlists",
  playlist: "Playlist",
};

/** Block options, with the web's defaults (lib/home-blocks.ts). */
function option(block: HomeBlock, key: string, fallback: boolean): boolean {
  return block.options?.[key] ?? fallback;
}

/**
 * One of the web user's home blocks as a TV row. The web stays the editor;
 * layouts and sizes there (cards/rows, xs–xl) all map to this one row style.
 * Renders nothing while loading or when empty, so a slow block doesn't leave
 * a hole.
 */
export function HomeBlockRow({
  block,
  region,
  nav,
  onCardFocusChange,
  onCardFocus,
  preferFirstFocus,
}: {
  block: HomeBlock;
  /** The row Home opens on: its first card takes focus. */
  preferFirstFocus?: boolean;
  region: string;
  nav: Nav;
  /** Bubbles card focus so Home can bring the row into view. */
  onCardFocusChange?: (focused: boolean) => void;
  /** The focused card and this row's title, for Home's spotlight. */
  onCardFocus?: (video: UnifiedVideo, title: string) => void;
}) {
  const progress = useProgressLookup();
  const { type } = block;
  const isFeed = isSubscriptionFeedBlock(type);
  // Kept mounted while Home is hidden: keeps its data without re-rendering,
  // and refetches the row's query on return if it went stale.
  const kept = useKeptQueryOptions();

  // Pages on as the row is scrolled, so every subscription upload is
  // reachable rather than the first 24.
  const subscriptions = trpc.subscriptions.mergedFeedInfinite.useInfiniteQuery(
    {
      limit: ROW_VIDEOS,
      hideShorts: option(block, "hideShorts", true),
      hideIgnored: option(block, "hideIgnored", true),
      ...blockFeedFilter(block),
    },
    {
      enabled: isFeed,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      ...kept,
    },
  );
  const recommended = trpc.feed.home.useQuery(
    { page: 1, pageSize: ROW_VIDEOS, region },
    { enabled: type === "recommended", ...kept },
  );
  const explore = trpc.live.list.useQuery(
    { limit: ROW_VIDEOS },
    { enabled: type === "explore", ...kept },
  );
  const history = trpc.history.list.useQuery(
    {
      page: 1,
      pageSize: ROW_VIDEOS,
      hideWatched: option(block, "hideCompleted", false),
    },
    { enabled: type === "history", ...kept },
  );
  const queue = trpc.queue.listDetailed.useQuery(undefined, {
    enabled: type === "queue",
    ...kept,
  });
  const saved = trpc.interactions.listSaved.useQuery(undefined, {
    enabled: type === "saved",
    ...kept,
  });
  const playlistId = block.playlistId ?? 0;
  const playlistItems = trpc.playlists.itemsDetailed.useQuery(
    { playlistId },
    { enabled: type === "playlist" && playlistId > 0, ...kept },
  );
  const playlists = trpc.playlists.list.useQuery(undefined, {
    enabled: type === "playlists" || type === "playlist",
    ...kept,
  });

  const rowQueries: Partial<
    Record<HomeBlock["type"], { isStale: boolean; refetch: () => unknown }>
  > = {
    subscriptions,
    recommended,
    explore,
    history,
    queue,
    saved,
    playlist: playlistItems,
    playlists,
  };
  const rowQuery = isFeed ? subscriptions : rowQueries[type];
  useRefetchStaleOnShow(rowQuery ?? NOTHING_TO_REFETCH);

  const videos: UnifiedVideo[] = useMemo(() => {
    const libraryRows = (
      rows:
        | {
            videoId: string;
            videoTitle: string;
            thumbnailUrl?: string;
            durationSeconds?: number;
            channelId?: string | null;
            channelName?: string | null;
            channelAvatarUrl?: string;
          }[]
        | undefined,
    ): UnifiedVideo[] =>
      (rows ?? []).map((row) => ({
        videoId: row.videoId,
        title: row.videoTitle,
        thumbnailUrl: row.thumbnailUrl,
        durationSeconds: row.durationSeconds,
        channelId: row.channelId ?? undefined,
        channelName: row.channelName ?? undefined,
        channelAvatarUrl: row.channelAvatarUrl,
      }));
    switch (type) {
      case "subscriptions":
      case "favorites":
      case "tag":
        return subscriptions.data?.pages.flatMap((p) => p.videos) ?? [];
      case "recommended":
        return recommended.data?.videos ?? [];
      case "explore":
        return explore.data?.videos ?? [];
      case "history":
        return (history.data ?? []).map((row) => ({
          videoId: row.videoId,
          title: row.videoTitle,
          thumbnailUrl: row.thumbnailUrl,
          channelId: row.channelId,
          channelName: row.channelName,
          channelAvatarUrl: row.channelAvatarUrl,
          durationSeconds: row.videoDurationSeconds || undefined,
        }));
      case "queue":
        return libraryRows(queue.data);
      case "saved":
        return libraryRows(saved.data);
      case "playlist":
        return libraryRows(playlistItems.data);
      case "playlists":
        // Playlists as cards: the first video's still, and the item count.
        return (playlists.data ?? []).map((p) => ({
          videoId: String(p.id),
          title: p.name,
          thumbnailUrl: p.previewVideoIds[0]
            ? stillUrl(p.previewVideoIds[0], "hqdefault.jpg")
            : undefined,
          channelName: `${p.itemCount} video${p.itemCount === 1 ? "" : "s"}`,
        }));
    }
  }, [
    type,
    subscriptions.data,
    recommended.data,
    explore.data,
    history.data,
    queue.data,
    saved.data,
    playlistItems.data,
    playlists.data,
  ]);

  // "Hide finished" on the library blocks and subscriptions.
  const hideFinished = option(block, "hideFinished", false);
  const shown = useMemo(
    () =>
      (hideFinished
        ? videos.filter((v) => !progress(v.videoId)?.completed)
        : videos
      ).slice(0, isFeed ? undefined : ROW_VIDEOS),
    [videos, hideFinished, progress, isFeed],
  );

  const title =
    type === "subscriptions" || type === "favorites" || type === "tag"
      ? homeBlockTitle(block)
      : type === "playlist"
        ? ((block.title?.trim() ||
            playlists.data?.find((p) => p.id === playlistId)?.name) ??
          HOME_BLOCK_TITLES.playlist)
        : block.title?.trim() || HOME_BLOCK_TITLES[type];

  // The row Home opens on keeps its place while it loads and says so when
  // it fails: rendering nothing let the rows below move up into its spot and
  // take the first focus, and hid why it was missing.
  const lead = rowQuery;
  if (shown.length === 0 && preferFirstFocus && lead) {
    const status = lead as {
      isPending?: boolean;
      isError?: boolean;
      error?: unknown;
    };
    if (status.isPending) return <SkeletonRows rows={1} />;
    if (status.isError) {
      return (
        <View style={styles.failed}>
          <Text style={styles.failedTitle}>{title} didn't load</Text>
          <Text style={styles.failedText}>{errorMessage(status.error)}</Text>
          <FocusButton
            label="Retry"
            hasTVPreferredFocus
            onPress={() => void lead.refetch()}
          />
        </View>
      );
    }
  }
  if (shown.length === 0) return null;

  if (type === "playlists") {
    // OK on a playlist plays it through from the first unfinished video.
    const playPlaylist = (id: string) => {
      const name = playlists.data?.find((p) => String(p.id) === id)?.name;
      trpcClient.playlists.itemsDetailed
        .query({ playlistId: Number(id) })
        .then((rows) => {
          const items = rows.map((row) => ({
            videoId: row.videoId,
            title: row.videoTitle,
            thumbnailUrl: row.thumbnailUrl,
            channelName: row.channelName ?? undefined,
          }));
          const first = playAllStart(items, progress);
          if (!first) return;
          nav.openVideo(first.videoId, {
            context: { source: "playlist", label: name, videos: items },
          });
        })
        .catch(() => {});
    };
    return (
      <VideoRow
        title={title}
        videos={shown}
        onSelect={playPlaylist}
        onCardFocusChange={onCardFocusChange}
        disableMenu
      />
    );
  }

  const context: PlayContext = {
    source:
      type === "queue" ? "queue" : type === "playlist" ? "playlist" : "feed",
    label: type === "queue" || type === "playlist" ? title : undefined,
    videos: shown,
  };
  return (
    <VideoRow
      title={title}
      videos={shown}
      preferFirstFocus={preferFirstFocus}
      onEndReached={
        isFeed
          ? () => {
              if (
                subscriptions.hasNextPage &&
                !subscriptions.isFetchingNextPage
              ) {
                void subscriptions.fetchNextPage();
              }
            }
          : undefined
      }
      onSelect={(videoId) => nav.openVideo(videoId, { context })}
      onCardFocusChange={(focused, video) => {
        onCardFocusChange?.(focused);
        if (focused && video) onCardFocus?.(video, title);
      }}
    />
  );
}

/** For a row type without a query of its own here. */
const NOTHING_TO_REFETCH = { isStale: false, refetch: () => undefined };

const styles = createStyles({
  failed: { gap: 10, alignItems: "flex-start" },
  failedTitle: {
    color: colors.cardTitle,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  failedText: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
