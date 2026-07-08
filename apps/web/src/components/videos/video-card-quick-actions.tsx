"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionSurface,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import { PlaylistPicker } from "@/components/videos/video-actions-menu";
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from "@/lib/quick-actions";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type VideoCardQuickActionsProps = {
  videoId: string;
  title: string;
  channelId?: string;
  surface?: VideoActionSurface;
  /** Positioning classes from the host card. */
  className?: string;
};

/**
 * The thumbnail hover buttons — the user's first three quick-action verbs
 * (defaults: Save, Ignore, Mark watched). Desktop-only: hidden on coarse
 * pointers, where the always-visible kebab and its bottom sheet take over.
 * "Add to playlist" opens the shared picker in a popover; membership state
 * shows as pills, so these buttons never persist un-hovered.
 */
export function VideoCardQuickActions({
  videoId,
  title,
  channelId,
  surface = "feed",
  className,
}: VideoCardQuickActionsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Plex-style on touch: the first tap on the thumbnail reveals the overlay
  // (and is swallowed); the next tap acts — a button, or the link itself.
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;

  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    if (!mq.matches) return;
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const onParentClick = (e: MouseEvent) => {
      if (revealedRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setRevealed(true);
    };
    const onDocPointerDown = (e: PointerEvent) => {
      if (!parent.contains(e.target as Node)) setRevealed(false);
    };
    parent.addEventListener("click", onParentClick, true);
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => {
      parent.removeEventListener("click", onParentClick, true);
      document.removeEventListener("pointerdown", onDocPointerDown);
    };
  }, []);

  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: authed,
    retry: false,
  });
  const quick: readonly QuickAction[] = (
    settings.data?.quickActions ?? DEFAULT_QUICK_ACTIONS
  ).slice(0, 3);

  const needsInteractionState = quick.some(
    (id) => id === "like" || id === "dislike",
  );
  const actions = useVideoActions({
    videoId,
    channelId,
    title,
    surface,
    withInteractionState: authed && needsInteractionState,
    loadPlaylists: pickerOpen,
  });

  const closePicker = useCallback(() => setPickerOpen(false), []);
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closePicker();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen, closePicker]);

  if (!authed || quick.length === 0) return null;

  const buttonClass = (active: boolean) =>
    cn(
      "flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-black/65 shadow-sm backdrop-blur-sm transition hover:bg-black/85 focus-visible:opacity-100 disabled:opacity-50",
      active ? "text-[hsl(var(--primary))]" : "text-white",
    );

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex flex-col gap-1.5",
        // Hidden at rest; hover reveals on desktop, first tap on touch.
        "pointer-events-none opacity-0 transition-opacity duration-150",
        "focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
        (pickerOpen || revealed) && "pointer-events-auto opacity-100",
        className,
      )}
    >
      {quick.map((id) => {
        if (id === "save") {
          // One-cue save: active when in Saved or any playlist; inactive
          // press captures to the inbox, active press opens the picker.
          const active = actions.state.saved || actions.playlistIds.size > 0;
          return (
            <button
              key={id}
              type="button"
              className={buttonClass(active || pickerOpen)}
              title={active ? "Saved — click to choose where" : "Save"}
              aria-label="Save"
              aria-pressed={active}
              aria-expanded={pickerOpen}
              disabled={actions.pending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (active) setPickerOpen((o) => !o);
                else actions.runAction("save");
              }}
            >
              <VideoActionGlyph id="save" active={active} className="h-4 w-4" />
            </button>
          );
        }
        if (id === "playlist") {
          return (
            <button
              key={id}
              type="button"
              className={buttonClass(pickerOpen)}
              title="Add to playlist"
              aria-label="Add to playlist"
              aria-expanded={pickerOpen}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPickerOpen((o) => !o);
              }}
            >
              <VideoActionGlyph id="playlist" className="h-4 w-4" />
            </button>
          );
        }
        const active = isVideoActionActive(id, actions.state);
        return (
          <button
            key={id}
            type="button"
            className={buttonClass(active)}
            title={actions.labelFor(id)}
            aria-label={actions.labelFor(id)}
            aria-pressed={active}
            disabled={actions.pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actions.runAction(id);
            }}
          >
            <VideoActionGlyph id={id} active={active} className="h-4 w-4" />
            <span className="sr-only">
              {videoActionShortLabel(id, actions.state)}
            </span>
          </button>
        );
      })}
      {pickerOpen ? (
        <div
          role="dialog"
          aria-label="Add to playlist"
          className="absolute right-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pt-2 text-sm shadow-lg"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <PlaylistPicker
            actions={actions}
            onBack={closePicker}
            includeSaved
            title="Save to"
          />
        </div>
      ) : null}
    </div>
  );
}
