"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DragHandleIcon,
  MoreIcon,
  PlaylistIcon,
  XIcon,
} from "@/components/videos/video-action-icons";
import { useRowDrag } from "@/components/videos/use-row-drag";
import { VideoGrid } from "@/components/videos/video-grid";
import {
  SubscriptionTagFilter,
  type TagState,
} from "@/components/subscriptions/subscription-tag-filter";
import { useWatchProgressMap } from "@/components/videos/video-membership-context";
import { VideoRow } from "@/components/videos/video-row";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import {
  CARD_MIN_WIDTH_PX,
  DEFAULT_HOME_BLOCKS,
  HOME_BLOCK_LABEL,
  HOME_BLOCK_LIMITS,
  HOME_BLOCK_ROWS,
  HOME_BLOCK_SIZE_LABEL,
  HOME_BLOCK_SIZES,
  type HomeBlock,
  type HomeBlockType,
  homeBlockHref,
  homeBlockOption,
  newHomeBlockId,
  SECTION_OPTIONS,
} from "@/lib/home-blocks";
import { cn } from "@/lib/utils";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { trpc } from "@/trpc/react";

/* ------------------------------ block data ------------------------------ */

/**
 * Columns an auto-fill grid would resolve at the container's width — same
 * formula as CSS `repeat(auto-fill, minmax(min(100%, minPx), 1fr))`.
 * Measured on the block wrapper (which always exists), so it also works when
 * the narrow-screen fallback renders rows instead of the grid.
 */
function useAutoFillColumns(minWidthPx: number, gapPx = 28) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      const w = element.getBoundingClientRect().width;
      setColumns(Math.max(1, Math.floor((w + gapPx) / (minWidthPx + gapPx))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, minWidthPx, gapPx]);
  return { ref: setElement, columns };
}

type BlockVideo = {
  videoId: string;
  title: string;
  channelId?: string | null;
  channelName?: string | null;
  channelAvatarUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
};

function toUnified(v: BlockVideo): UnifiedVideo {
  return {
    videoId: v.videoId,
    title: v.title,
    channelId: v.channelId ?? undefined,
    channelName: v.channelName ?? undefined,
    channelAvatarUrl: v.channelAvatarUrl ?? undefined,
    thumbnailUrl: v.thumbnailUrl ?? undefined,
    durationSeconds: v.durationSeconds,
  } as UnifiedVideo;
}

function VideoBlockBody({
  videos,
  block,
  surface,
  isLoading,
}: {
  videos: BlockVideo[];
  block: HomeBlock;
  surface: VideoActionSurface;
  isLoading: boolean;
}) {
  // Cards render full rows only: computed columns × configured rows, so the
  // last row is never ragged regardless of viewport width. At one column a
  // "card" is just an oversized row — fall back to the compact rows layout
  // with a doubled count (similar content, phone-appropriate density).
  const grid = useAutoFillColumns(CARD_MIN_WIDTH_PX[block.size]);
  const singleColumn = grid.columns <= 1;
  const layout =
    block.layout === "cards" && singleColumn ? "rows" : block.layout;
  const rowCount =
    block.layout === "cards" && singleColumn ? block.rows * 2 : block.limit;
  if (isLoading && videos.length === 0) {
    return (
      <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">
        Loading…
      </p>
    );
  }
  if (videos.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Nothing here yet.
      </p>
    );
  }
  if (layout === "cards") {
    return (
      <div ref={grid.ref}>
        <VideoGrid
          videos={videos.slice(0, grid.columns * block.rows).map(toUnified)}
          size="large"
          minColumnWidthPx={CARD_MIN_WIDTH_PX[block.size]}
          enableSwipe
          surface={surface}
        />
      </div>
    );
  }
  return (
    <ul ref={grid.ref} className="space-y-1">
      {videos.slice(0, rowCount).map((v) => (
        <li key={v.videoId}>
          <VideoRow
            videoId={v.videoId}
            title={v.title}
            channelId={v.channelId}
            channelName={v.channelName}
            thumbnailUrl={v.thumbnailUrl}
            durationSeconds={v.durationSeconds}
            surface={surface}
            size={singleColumn ? "sm" : block.size}
            enableSwipe
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Tag filters for a subscriptions block, stored in the options record as
 * `tag:<name>` keys — true = include ("only these"), false = exclude, absent
 * = off. Mirrors the tri-state filter on the subscriptions page.
 */
const TAG_OPTION_PREFIX = "tag:";

function blockTagState(block: HomeBlock, tag: string): TagState {
  const value = block.options?.[`${TAG_OPTION_PREFIX}${tag}`];
  if (value === true) return "include";
  if (value === false) return "exclude";
  return "off";
}

function blockTagLists(block: HomeBlock): {
  includeTags: string[] | undefined;
  excludeTags: string[] | undefined;
} {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const [key, value] of Object.entries(block.options ?? {})) {
    if (!key.startsWith(TAG_OPTION_PREFIX)) continue;
    const tag = key.slice(TAG_OPTION_PREFIX.length);
    if (value === true) include.push(tag);
    else if (value === false) exclude.push(tag);
  }
  return {
    includeTags: include.length > 0 ? include : undefined,
    excludeTags: exclude.length > 0 ? exclude : undefined,
  };
}

/** Drops completed videos when the block's hide-finished option is on. */
function useHideFinished(block: HomeBlock, videos: BlockVideo[]): BlockVideo[] {
  const progressMap = useWatchProgressMap();
  if (!homeBlockOption(block, "hideFinished")) return videos;
  return videos.filter((v) => !progressMap.get(v.videoId)?.completed);
}

/** Items a block needs at most: full rows on wide screens, or the limit. */
function blockFetchCount(block: HomeBlock): number {
  return block.layout === "cards" ? block.rows * 8 : block.limit;
}

function SubscriptionsBlockBody({ block }: { block: HomeBlock }) {
  const { includeTags, excludeTags } = blockTagLists(block);
  // Over-fetch: the feed strips shorts/restricted *after* the limit, so a
  // page of exactly `limit` often arrives short.
  const query = trpc.subscriptions.mergedFeedInfinite.useQuery({
    limit: Math.min(48, Math.max(8, blockFetchCount(block) * 2)),
    includeTags,
    excludeTags,
  });
  const videos = useHideFinished(
    block,
    (query.data?.videos ?? []) as BlockVideo[],
  );
  return (
    <VideoBlockBody
      videos={videos.slice(0, blockFetchCount(block))}
      block={block}
      surface="subscriptions"
      isLoading={query.isPending}
    />
  );
}

function HistoryBlockBody({ block }: { block: HomeBlock }) {
  // The block's own value for the shared option definition — independent of
  // the History page's filter.
  const query = trpc.history.list.useQuery({
    page: 1,
    pageSize: Math.min(24, blockFetchCount(block)),
    hideWatched: homeBlockOption(block, "hideCompleted"),
  });
  const videos: BlockVideo[] = (query.data ?? []).map((item) => ({
    videoId: item.videoId,
    title: item.videoTitle ?? item.videoId,
    channelId: item.channelId,
    channelName: item.channelName,
    channelAvatarUrl: item.channelAvatarUrl,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds:
      item.videoDurationSeconds > 0 ? item.videoDurationSeconds : undefined,
  }));
  return (
    <VideoBlockBody
      videos={videos}
      block={block}
      surface="history"
      isLoading={query.isPending}
    />
  );
}

function QueueBlockBody({ block }: { block: HomeBlock }) {
  const query = trpc.queue.listDetailed.useQuery();
  const videos: BlockVideo[] = (query.data ?? [])
    .slice(0, blockFetchCount(block))
    .map((item) => ({
      videoId: item.videoId,
      title: item.videoTitle,
      channelId: item.channelId,
      channelName: item.channelName,
      channelAvatarUrl: item.channelAvatarUrl,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
    }));
  const visible = useHideFinished(block, videos);
  return (
    <VideoBlockBody
      videos={visible}
      block={block}
      surface="queue"
      isLoading={query.isPending}
    />
  );
}

function SavedBlockBody({ block }: { block: HomeBlock }) {
  const query = trpc.interactions.listSaved.useQuery();
  const videos: BlockVideo[] = (query.data ?? [])
    .slice(0, blockFetchCount(block))
    .map((item) => ({
      videoId: item.videoId,
      title: item.videoTitle,
      channelId: item.channelId,
      channelName: item.channelName,
      channelAvatarUrl: item.channelAvatarUrl,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
    }));
  const visible = useHideFinished(block, videos);
  return (
    <VideoBlockBody
      videos={visible}
      block={block}
      surface="saved"
      isLoading={query.isPending}
    />
  );
}

function PlaylistBlockBody({ block }: { block: HomeBlock }) {
  const playlistId = block.playlistId ?? 0;
  const query = trpc.playlists.itemsDetailed.useQuery(
    { playlistId },
    { enabled: playlistId > 0 },
  );
  const videos: BlockVideo[] = (query.data ?? [])
    .slice(0, blockFetchCount(block))
    .map((item) => ({
      videoId: item.videoId,
      title: item.videoTitle,
      channelId: item.channelId,
      channelName: item.channelName,
      channelAvatarUrl: item.channelAvatarUrl,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
    }));
  const visible = useHideFinished(block, videos);
  return (
    <VideoBlockBody
      videos={visible}
      block={block}
      surface="playlist"
      isLoading={query.isPending}
    />
  );
}

/** The playlists overview as a block: collage tiles (cards) or rows. */
function PlaylistsBlockBody({ block }: { block: HomeBlock }) {
  const query = trpc.playlists.list.useQuery();
  const grid = useAutoFillColumns(CARD_MIN_WIDTH_PX[block.size], 16);
  const singleColumn = grid.columns <= 1;
  const asCards = block.layout === "cards" && !singleColumn;
  const playlists = (query.data ?? []).slice(
    0,
    block.layout === "cards"
      ? singleColumn
        ? block.rows * 2
        : grid.columns * block.rows
      : block.limit,
  );
  if (query.isPending) {
    return (
      <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">
        Loading…
      </p>
    );
  }
  if (playlists.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No playlists yet.
      </p>
    );
  }

  const collage = (p: (typeof playlists)[number], compact: boolean) => (
    <div
      className={cn(
        "relative aspect-video shrink-0 overflow-hidden rounded-xl bg-[hsl(var(--muted))]",
        compact ? "w-[12.75rem] sm:w-60" : "w-full",
      )}
    >
      {p.previewVideoIds.length > 0 ? (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
          {[0, 1, 2, 3].map((slot) => {
            const videoId = p.previewVideoIds[slot];
            return videoId ? (
              <VideoThumbnailImg
                key={videoId}
                videoId={videoId}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span
                key={`empty-${slot}`}
                className="block h-full w-full bg-[hsl(var(--muted))]"
              />
            );
          })}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]">
          <PlaylistIcon className="h-8 w-8" />
        </div>
      )}
      <span className="absolute bottom-1 right-1 z-10 rounded-md bg-black/78 px-1.5 py-px font-mono text-[10px] font-semibold text-white">
        {p.itemCount} {p.itemCount === 1 ? "video" : "videos"}
      </span>
    </div>
  );

  if (asCards) {
    return (
      <ul
        ref={grid.ref}
        className="grid gap-x-4 gap-y-6"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${CARD_MIN_WIDTH_PX[block.size]}px), 1fr))`,
        }}
      >
        {playlists.map((p) => (
          <li key={p.id} className="group">
            <Link href={`/playlists/${p.id}`} className="block">
              {collage(p, false)}
              <p className="mt-2 line-clamp-1 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
                {p.name}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul ref={grid.ref} className="space-y-1">
      {playlists.map((p) => (
        <li key={p.id}>
          <Link
            href={`/playlists/${p.id}`}
            className="group flex items-center gap-3 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]"
          >
            {collage(p, true)}
            <p className="m-0 line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
              {p.name}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BlockBody({ block }: { block: HomeBlock }) {
  switch (block.type) {
    case "subscriptions":
      return <SubscriptionsBlockBody block={block} />;
    case "history":
      return <HistoryBlockBody block={block} />;
    case "queue":
      return <QueueBlockBody block={block} />;
    case "saved":
      return <SavedBlockBody block={block} />;
    case "playlists":
      return <PlaylistsBlockBody block={block} />;
    case "playlist":
      return <PlaylistBlockBody block={block} />;
  }
}

/* ------------------------------ block chrome ----------------------------- */

function BlockHeading({ block }: { block: HomeBlock }) {
  const playlistName = trpc.playlists.list
    .useQuery(undefined, {
      enabled: block.type === "playlist",
    })
    .data?.find((p) => p.id === block.playlistId)?.name;
  const label =
    block.type === "playlist"
      ? (playlistName ?? "Playlist")
      : HOME_BLOCK_LABEL[block.type];
  return (
    <Link
      href={homeBlockHref(block)}
      className="group/h inline-flex items-center gap-2"
    >
      <h2 className="m-0 text-2xl font-extrabold leading-tight tracking-tight transition group-hover/h:text-[hsl(var(--primary))]">
        {label}
      </h2>
      <span
        aria-hidden
        className="text-xl text-[hsl(var(--muted-foreground))] transition group-hover/h:translate-x-0.5 group-hover/h:text-[hsl(var(--primary))]"
      >
        ›
      </span>
    </Link>
  );
}

/**
 * Per-block options behind a dot menu (edit mode) — options live in the
 * shared sectionPrefs "base", so the section's own page stays in sync.
 */
function BlockOptionsMenu({
  block,
  onPatch,
}: {
  block: HomeBlock;
  onPatch: (patch: Partial<HomeBlock>) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const defs = SECTION_OPTIONS[block.type] ?? [];
  const withTags = block.type === "subscriptions";
  const allTags = trpc.channelTags.listAll.useQuery(undefined, {
    enabled: open && withTags,
  });

  const cycleTag = (tag: string) => {
    const key = `${TAG_OPTION_PREFIX}${tag}`;
    const state = blockTagState(block, tag);
    const next = { ...block.options };
    if (state === "off") next[key] = true;
    else if (state === "include") next[key] = false;
    else delete next[key];
    onPatch({ options: next });
  };

  const setAllTags = (state: "off" | "exclude") => {
    const next = { ...block.options };
    for (const key of Object.keys(next)) {
      if (key.startsWith(TAG_OPTION_PREFIX)) delete next[key];
    }
    if (state === "exclude") {
      for (const { tag } of allTags.data ?? []) {
        next[`${TAG_OPTION_PREFIX}${tag}`] = false;
      }
    }
    onPatch({ options: next });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (defs.length === 0 && !withTags) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        title="Block options"
        aria-label="Block options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-72 max-w-[85vw] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 text-sm shadow-lg"
        >
          {defs.map((def) => (
            <label
              key={def.key}
              className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-[hsl(var(--muted)_/_0.65)]"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={homeBlockOption(block, def.key)}
                onChange={(e) =>
                  onPatch({
                    options: {
                      ...block.options,
                      [def.key]: e.currentTarget.checked,
                    },
                  })
                }
              />
              {def.label}
            </label>
          ))}
          {withTags && (allTags.data ?? []).length > 0 ? (
            <div
              className={cn(
                "px-2.5 py-2",
                defs.length > 0 &&
                  "mt-1 border-t border-[hsl(var(--border))] pt-2.5",
              )}
            >
              <SubscriptionTagFilter
                tags={allTags.data ?? []}
                stateFor={(tag) => blockTagState(block, tag)}
                onCycle={cycleTag}
                onShowAll={() => setAllTags("off")}
                onHideAll={() => setAllTags("exclude")}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- add-block menu ---------------------------- */

const ADDABLE_TYPES: Exclude<HomeBlockType, "playlist">[] = [
  "subscriptions",
  "history",
  "queue",
  "saved",
  "playlists",
];

function AddBlockMenu({ onAdd }: { onAdd: (block: HomeBlock) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const playlists = trpc.playlists.list.useQuery(undefined, { enabled: open });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const add = (type: HomeBlockType, playlistId?: number) => {
    onAdd({
      id: newHomeBlockId(),
      type,
      playlistId,
      limit: type === "playlists" ? 4 : 8,
      rows: type === "playlists" ? 1 : 2,
      layout: "cards",
      size: "md",
    });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button type="button" size="sm" onClick={() => setOpen((o) => !o)}>
        Add block
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 max-h-80 w-60 overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 text-sm shadow-lg"
        >
          {ADDABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="flex w-full items-center px-3 py-2 text-left transition hover:bg-[hsl(var(--muted)_/_0.65)]"
              onClick={() => add(type)}
            >
              {HOME_BLOCK_LABEL[type]}
            </button>
          ))}
          {(playlists.data ?? []).length > 0 ? (
            <>
              <p className="border-t border-[hsl(var(--border))] px-3 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                Specific playlist
              </p>
              {(playlists.data ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[hsl(var(--muted)_/_0.65)]"
                  onClick={() => add("playlist", p.id)}
                >
                  <PlaylistIcon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

/**
 * The modular home page: user-configured blocks mirroring the sidebar
 * sections, reorderable in edit mode with per-block layout and size.
 * Configuration persists in the settings profile (homeBlocks).
 */
export function HomeBlocksClient() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSettled: () => utils.settings.get.invalidate(),
  });

  const [blocks, setBlocks] = useState<HomeBlock[]>(DEFAULT_HOME_BLOCKS);
  const [editing, setEditing] = useState(false);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (settings.data?.homeBlocks && !hydratedRef.current) {
      hydratedRef.current = true;
      setBlocks(settings.data.homeBlocks);
    }
  }, [settings.data?.homeBlocks]);

  const persist = useCallback(
    (next: HomeBlock[]) => {
      setBlocks(next);
      update.mutate({ homeBlocks: next });
    },
    [update],
  );

  const drag = useRowDrag({
    count: blocks.length,
    onMove: (from, to) =>
      setBlocks((arr) => {
        const next = [...arr];
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        return next;
      }),
    onDrop: () =>
      setBlocks((current) => {
        update.mutate({ homeBlocks: current });
        return current;
      }),
  });

  const patchBlock = (id: string, patch: Partial<HomeBlock>) =>
    persist(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-extrabold tracking-tight">Home</h1>
        <div className="flex items-center gap-2">
          {editing ? (
            <AddBlockMenu onAdd={(b) => persist([...blocks, b])} />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={editing ? "default" : "outline"}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Your home is empty — hit <strong>Edit</strong> and add a block.
        </p>
      ) : null}

      <ul
        className="select-none space-y-9"
        {...(editing ? drag.listProps : {})}
      >
        {blocks.map((block, i) => {
          const isDragging = editing && drag.dragging === i;
          return (
            <li
              key={block.id}
              ref={editing ? drag.setRowRef(i) : undefined}
              style={
                isDragging
                  ? { transform: `translateY(${drag.dragY}px)` }
                  : undefined
              }
              className={cn(
                "space-y-3",
                isDragging &&
                  "relative z-10 rounded-[var(--radius-card)] bg-[hsl(var(--card))] p-3 shadow-lg ring-1 ring-[hsl(var(--border))]",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {editing ? (
                  <button
                    type="button"
                    className="cursor-grab touch-none select-none py-1 pr-1 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
                    onPointerDown={(e) => drag.handlePointerDown(e, i)}
                    aria-label="Drag to reorder block"
                  >
                    <DragHandleIcon className="h-[18px] w-[18px]" />
                  </button>
                ) : null}
                <BlockHeading block={block} />
                <span className="ml-auto" />
                {editing ? (
                  <>
                    {/* item size */}
                    <div className="flex overflow-hidden rounded-full border border-[hsl(var(--border))] text-xs font-medium">
                      {HOME_BLOCK_SIZES.map((size) => (
                        <button
                          key={size}
                          type="button"
                          aria-pressed={block.size === size}
                          title={`Item size ${HOME_BLOCK_SIZE_LABEL[size]}`}
                          className={cn(
                            "px-2.5 py-1 transition",
                            block.size === size
                              ? "bg-[hsl(var(--primary))] text-white"
                              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                          )}
                          onClick={() => patchBlock(block.id, { size })}
                        >
                          {HOME_BLOCK_SIZE_LABEL[size]}
                        </button>
                      ))}
                    </div>
                    {/* cards ⇄ rows */}
                    <div className="flex overflow-hidden rounded-full border border-[hsl(var(--border))] text-xs font-medium">
                      {(["cards", "rows"] as const).map((layout) => (
                        <button
                          key={layout}
                          type="button"
                          aria-pressed={block.layout === layout}
                          className={cn(
                            "px-3 py-1 transition",
                            block.layout === layout
                              ? "bg-[hsl(var(--primary))] text-white"
                              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                          )}
                          onClick={() => patchBlock(block.id, { layout })}
                        >
                          {layout === "cards" ? "Cards" : "Rows"}
                        </button>
                      ))}
                    </div>
                    {block.layout === "cards" ? (
                      <select
                        className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-xs"
                        value={block.rows}
                        aria-label="Number of rows"
                        onChange={(e) =>
                          patchBlock(block.id, {
                            rows: Number(e.currentTarget.value),
                          })
                        }
                      >
                        {HOME_BLOCK_ROWS.map((n) => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? "row" : "rows"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-xs"
                        value={block.limit}
                        aria-label="Number of items"
                        onChange={(e) =>
                          patchBlock(block.id, {
                            limit: Number(e.currentTarget.value),
                          })
                        }
                      >
                        {HOME_BLOCK_LIMITS.map((n) => (
                          <option key={n} value={n}>
                            {n} items
                          </option>
                        ))}
                      </select>
                    )}
                    <BlockOptionsMenu
                      block={block}
                      onPatch={(patch) => patchBlock(block.id, patch)}
                    />
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                      title="Remove block"
                      aria-label="Remove block"
                      onClick={() =>
                        persist(blocks.filter((b) => b.id !== block.id))
                      }
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
              </div>
              <BlockBody block={block} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
