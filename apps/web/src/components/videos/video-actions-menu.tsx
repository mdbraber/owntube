"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVideoActions } from "@/components/videos/use-video-actions";
import { CheckIcon, MoreIcon } from "@/components/videos/video-action-icons";
import {
  type VideoActionId,
  type VideoActionSurface,
  VideoActionGlyph,
  videoActionGroupsForSurface,
} from "@/components/videos/video-action-registry";
import { QuickActionChips } from "@/components/videos/video-action-chips";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from "@/lib/quick-actions";
import { formatRecommendationReason } from "@/lib/recommendation-reason";
import { cn } from "@/lib/utils";
import type { RecommendationReason } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

/** Surface-specific leading entry (e.g. "Remove from history" on rows). */
export type VideoActionsMenuTopItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

type VideoActionsMenuProps = {
  videoId: string;
  title: string;
  channelId?: string;
  channelName?: string;
  /** Thumbnail for the bottom sheet header. */
  thumbnailUrl?: string;
  surface?: VideoActionSurface;
  /** When set, the menu opens with a non-interactive "why recommended" line. */
  recommendationReason?: RecommendationReason;
  topItems?: VideoActionsMenuTopItem[];
  className?: string;
};

type MenuView = "main" | "playlist";

/**
 * True when the menu should present as a bottom sheet: a touch-only device at
 * phone width. Larger touch screens (iPad) have room for the popover — the
 * kebab stays always-visible there, only the presentation differs.
 */
function useSheetPresentation(): boolean {
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (max-width: 767px)");
    setSheet(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSheet(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return sheet;
}

function menuItemClass(active = false) {
  return cn(
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition disabled:opacity-50",
    active
      ? "text-[hsl(var(--primary))]"
      : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)_/_0.65)]",
  );
}

/**
 * "Add to playlist" second step — a checklist (a video can join or leave
 * several playlists in one visit) with an inline create field. Rendered
 * in-place inside whichever surface hosts it (popover view swap, sheet page,
 * shorts rail panel); never a second stacked overlay.
 */
export function PlaylistPicker({
  actions,
  onBack,
}: {
  actions: ReturnType<typeof useVideoActions>;
  onBack: () => void;
}) {
  const [createMode, setCreateMode] = useState(false);
  const [name, setName] = useState("");

  const submitCreate = () => {
    if (!name.trim()) return;
    void actions.createPlaylistAndAdd(name).then(() => {
      setName("");
      setCreateMode(false);
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-[hsl(var(--border))] pb-1.5">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-base leading-none text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          aria-label="Back"
          onClick={() => {
            if (createMode) setCreateMode(false);
            else onBack();
          }}
        >
          ‹
        </button>
        <span className="text-sm font-semibold">Add to playlist</span>
      </div>
      {!createMode ? (
        <>
          <ul className="max-h-56 overflow-y-auto py-1">
            {actions.playlists.isLoading ? (
              <li className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                Loading…
              </li>
            ) : null}
            {actions.playlists.data?.map((p) => {
              const isIn = actions.playlistIds.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={menuItemClass()}
                    disabled={actions.pending}
                    aria-pressed={isIn}
                    onClick={() => void actions.togglePlaylist(p.id, p.name)}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        isIn
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white"
                          : "border-[hsl(var(--border))]",
                      )}
                      aria-hidden
                    >
                      {isIn ? <CheckIcon className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
                      {p.itemCount}
                    </span>
                  </button>
                </li>
              );
            })}
            {!actions.playlists.isLoading &&
            (actions.playlists.data?.length ?? 0) === 0 ? (
              <li className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                No playlists yet
              </li>
            ) : null}
          </ul>
          <button
            type="button"
            className={cn(
              menuItemClass(),
              "border-t border-[hsl(var(--border))] font-medium",
            )}
            onClick={() => setCreateMode(true)}
          >
            New playlist…
          </button>
        </>
      ) : (
        <div className="space-y-2 p-2">
          <Input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Playlist name"
            maxLength={120}
            // biome-ignore lint/a11y/noAutofocus: user just chose "New playlist"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
          <Button
            type="button"
            className="w-full"
            size="sm"
            disabled={!name.trim() || actions.pending}
            onClick={submitCreate}
          >
            Create and add
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The complete, context-aware action menu for a video — the single overflow
 * surface everywhere: a popover on pointer devices, a bottom sheet with
 * thumbnail header + quick-action chips on touch. Items come from the shared
 * action registry, trimmed per `surface`; "Add to playlist" navigates within
 * the surface (view swap / page push), never a second overlay.
 */
export function VideoActionsMenu({
  videoId,
  title,
  channelId,
  channelName,
  thumbnailUrl,
  surface = "feed",
  recommendationReason,
  topItems,
  className,
}: VideoActionsMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("main");
  const asSheet = useSheetPresentation();

  const actions = useVideoActions({
    videoId,
    channelId,
    channelName,
    title,
    surface,
    withInteractionState: open,
    loadPlaylists: open && (asSheet || view !== "main"),
  });

  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    enabled: open && asSheet,
    retry: false,
  });
  const quickActions: readonly QuickAction[] =
    settingsQuery.data?.quickActions ?? DEFAULT_QUICK_ACTIONS;

  const close = useCallback(() => {
    setOpen(false);
    setView("main");
  }, []);

  // Outside click / Escape for the popover variant.
  useEffect(() => {
    if (!open || asSheet) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, asSheet, close]);

  // Body scroll lock + Escape for the sheet variant.
  useEffect(() => {
    if (!open || !asSheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, asSheet, close]);

  const runAndClose = (id: Exclude<VideoActionId, "playlist">) => {
    actions.runAction(id);
    close();
  };

  const groups = videoActionGroupsForSurface(surface);
  // The sheet's chip row already covers its verbs — don't repeat them below.
  const chipIds = asSheet
    ? new Set<VideoActionId>(quickActions.slice(0, 4))
    : new Set<VideoActionId>();
  const listGroups = groups
    .map((g) => g.filter((id) => !chipIds.has(id)))
    .filter((g) => g.length > 0);

  const mainList = (
    <>
      {topItems?.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={menuItemClass()}
          disabled={actions.pending}
          onClick={() => {
            item.onSelect();
            close();
          }}
        >
          {item.icon ? (
            <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
              {item.icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
      {topItems && topItems.length > 0 ? (
        <hr className="my-1 border-[hsl(var(--border))]" />
      ) : null}
      {listGroups.map((group, gi) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static group order
        <div key={gi}>
          {gi > 0 ? <hr className="my-1 border-[hsl(var(--border))]" /> : null}
          {group.map((id) =>
            id === "playlist" ? (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={menuItemClass()}
                disabled={actions.pending}
                onClick={() => setView("playlist")}
              >
                <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
                  <VideoActionGlyph id="playlist" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {actions.labelFor("playlist")}
                </span>
                <span className="text-[hsl(var(--muted-foreground))]">›</span>
              </button>
            ) : (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={menuItemClass(actions.isActive(id))}
                disabled={
                  actions.pending ||
                  (id === "block-channel" &&
                    (!channelId || actions.state.channelBlocked)) ||
                  (id === "watched" && actions.state.watched)
                }
                onClick={() => runAndClose(id)}
              >
                <span
                  className={cn(
                    "shrink-0",
                    actions.isActive(id)
                      ? "text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))]",
                  )}
                >
                  <VideoActionGlyph id={id} active={actions.isActive(id)} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {actions.labelFor(id)}
                </span>
                {actions.isActive(id) ? (
                  <CheckIcon className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
                ) : null}
              </button>
            ),
          )}
        </div>
      ))}
    </>
  );

  const playlistPicker = (
    <PlaylistPicker actions={actions} onBack={() => setView("main")} />
  );

  const reasonLine = recommendationReason ? (
    <p
      role="presentation"
      className="border-b border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]"
    >
      {formatRecommendationReason(recommendationReason)}
    </p>
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full text-[hsl(var(--muted-foreground))] opacity-100 transition-opacity duration-200 hover:bg-[hsl(var(--muted)_/_0.65)] hover:text-[hsl(var(--foreground))] [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        aria-label="Video options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-state={open ? "open" : "closed"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
      >
        <MoreIcon className="h-5 w-5" />
      </Button>

      {open && !asSheet ? (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full right-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 text-sm shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {view === "main" ? (
            <>
              {reasonLine}
              {mainList}
            </>
          ) : (
            playlistPicker
          )}
        </div>
      ) : null}

      {open && asSheet
        ? createPortal(
            <div className="fixed inset-0 z-[60]" id={menuId}>
              <button
                type="button"
                aria-label="Close"
                className="absolute inset-0 bg-black/45 animate-[ot-fade-in_180ms_ease-out] motion-reduce:animate-none"
                onClick={close}
              />
              <div
                role="dialog"
                aria-label="Video actions"
                className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] pb-[max(env(safe-area-inset-bottom),0.75rem)] animate-[ot-sheet-in_260ms_cubic-bezier(0.32,0.72,0.22,1)] motion-reduce:animate-none"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div
                  aria-hidden
                  className="mx-auto mt-2 h-1 w-9 rounded-full bg-[hsl(var(--border))]"
                />
                {view === "main" ? (
                  <>
                    <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
                      <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
                        <VideoThumbnailImg
                          url={thumbnailUrl}
                          videoId={videoId}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug">
                          {title}
                        </p>
                        {channelName ? (
                          <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
                            {channelName}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <QuickActionChips
                      ids={quickActions}
                      actions={actions}
                      className="border-b border-[hsl(var(--border))] px-3 py-3"
                    />
                    {reasonLine}
                    <div className="px-1 py-1 [&_button]:py-2.5">
                      {mainList}
                    </div>
                  </>
                ) : (
                  <div className="px-2 pt-2 [&_button]:py-2.5">
                    {playlistPicker}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
