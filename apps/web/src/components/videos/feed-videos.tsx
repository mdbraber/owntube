"use client";

import { useEffect } from "react";
import type { FeedPagePrefs } from "@/components/library/section-options-menu";
import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { VideoGrid } from "@/components/videos/video-grid";
import { VideoRow } from "@/components/videos/video-row";
import { useAutoFillColumns } from "@/hooks/use-auto-fill-columns";
import { CARD_MIN_WIDTH_PX } from "@/lib/home-blocks";
import { formatPublishedLabel } from "@/lib/video-display";
import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * A feed page's videos as cards or a list at the page's size, like a home
 * block (Subscriptions, Favorites, tag and channel pages). With a row
 * cap it shows exactly that many (full card rows at the measured column
 * count), fetching pages until they're filled; uncapped, the caller's
 * sentinel keeps scrolling. A single column (phones) always renders cards.
 */
export function FeedVideos({
  videos,
  surface,
  enableSwipe = true,
  dimVideoIds,
  prefs,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  videos: UnifiedVideo[];
  /** Card surface (menu trimming, pill omission). */
  surface: VideoActionSurface;
  enableSwipe?: boolean;
  /** Ids to dim in place instead of hiding (channel pages' ignored videos). */
  dimVideoIds?: ReadonlySet<string>;
  prefs: Pick<FeedPagePrefs, "rowSize" | "layout" | "rows">;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Stable (React Query binds it), so the fill effect runs on change only. */
  fetchNextPage: () => unknown;
}) {
  const minColumnWidthPx = CARD_MIN_WIDTH_PX[prefs.rowSize];
  const grid = useAutoFillColumns(minColumnWidthPx);
  const singleColumn = grid.columns <= 1;
  const layout = singleColumn ? "cards" : prefs.layout;
  const cap =
    prefs.rows === 0
      ? null
      : layout === "cards"
        ? grid.columns * prefs.rows
        : prefs.rows;
  const short = cap !== null && videos.length < cap;
  useEffect(() => {
    if (short && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [short, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const shown = cap === null ? videos : videos.slice(0, cap);

  return (
    <div ref={grid.ref}>
      {layout === "cards" ? (
        <VideoGrid
          videos={shown}
          size="large"
          minColumnWidthPx={minColumnWidthPx}
          enableSwipe={enableSwipe}
          dimVideoIds={dimVideoIds}
          surface={surface}
        />
      ) : (
        <ul className="space-y-1">
          {shown.map((v) => (
            <li key={v.videoId}>
              <VideoRow
                videoId={v.videoId}
                title={v.title}
                channelId={v.channelId}
                channelName={v.channelName}
                thumbnailUrl={v.thumbnailUrl}
                durationSeconds={v.durationSeconds}
                meta={
                  formatPublishedLabel(v.publishedText, v.publishedAt) ??
                  undefined
                }
                surface={surface}
                size={prefs.rowSize}
                enableSwipe={enableSwipe}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
