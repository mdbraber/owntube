"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionSurface,
  VideoActionGlyph,
} from "@/components/videos/video-action-registry";
import { PlaylistPicker } from "@/components/videos/video-actions-menu";
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from "@/lib/quick-actions";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type VideoRowQuickActionsProps = {
  videoId: string;
  title: string;
  channelId?: string;
  surface: VideoActionSurface;
  className?: string;
};

/**
 * Hover-revealed quick actions on library rows (wide screens have the room):
 * the user's full quick-action preset as ghost icon buttons in the row's
 * trailing cluster, next to ✕ and the kebab. Hidden on touch, where the
 * kebab's bottom sheet carries the same verbs. "Add to playlist" opens the
 * shared picker in a popover.
 */
export function VideoRowQuickActions({
  videoId,
  title,
  channelId,
  surface,
  className,
}: VideoRowQuickActionsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: authed,
    retry: false,
  });
  const quick: readonly QuickAction[] =
    settings.data?.quickActions ?? DEFAULT_QUICK_ACTIONS;

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

  return (
    <div
      ref={rootRef}
      className={cn(
        // Desktop only: touch gets the same verbs via the kebab's sheet.
        "relative hidden items-center gap-0.5 [@media(hover:hover)]:flex",
        "opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100",
        pickerOpen && "opacity-100",
        className,
      )}
    >
      {quick.map((id) => {
        const isPicker = id === "playlist";
        const active = isPicker
          ? pickerOpen
          : isVideoActionActive(id, actions.state);
        const label = isPicker ? "Add to playlist" : actions.labelFor(id);
        return (
          <button
            key={id}
            type="button"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[hsl(var(--muted))] disabled:opacity-30",
              active
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
            )}
            title={label}
            aria-label={label}
            aria-pressed={active}
            disabled={!isPicker && actions.pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isPicker) setPickerOpen((o) => !o);
              else actions.runAction(id);
            }}
          >
            <VideoActionGlyph
              id={id}
              active={!isPicker && active}
              className="h-4 w-4"
            />
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
          <PlaylistPicker actions={actions} onBack={closePicker} />
        </div>
      ) : null}
    </div>
  );
}
