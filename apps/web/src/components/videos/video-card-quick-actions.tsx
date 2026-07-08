"use client";

import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionSurface,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
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
 * The two thumbnail hover buttons (user's first two quick-action verbs;
 * defaults: Queue, Save). Desktop-only — hidden on coarse pointers, where the
 * always-visible kebab and its bottom sheet take over. Membership state shows
 * as pills in the thumbnail's bottom row, so these buttons never persist
 * un-hovered; the active treatment is a filled brand glyph on the same
 * neutral scrim chip.
 */
export function VideoCardQuickActions({
  videoId,
  title,
  channelId,
  surface = "feed",
  className,
}: VideoCardQuickActionsProps) {
  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: authed,
    retry: false,
  });
  const quick: readonly QuickAction[] = (
    settings.data?.quickActions ?? DEFAULT_QUICK_ACTIONS
  ).slice(0, 2);
  // Discovery feeds (Recommended/Trending/Search) get Ignore on top of the
  // stack — triage is the primary gesture there.
  const stack: readonly QuickAction[] =
    surface === "feed" && !quick.includes("ignore")
      ? ["ignore", ...quick]
      : quick;

  const needsInteractionState = quick.some(
    (id) => id === "like" || id === "dislike",
  );
  const actions = useVideoActions({
    videoId,
    channelId,
    title,
    surface,
    withInteractionState: authed && needsInteractionState,
  });

  if (!authed || quick.length === 0) return null;

  return (
    <div
      className={cn(
        // pointer-fine only: on touch the kebab/bottom sheet is the path.
        "hidden flex-col gap-1.5 [@media(hover:hover)]:flex",
        "opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100",
        className,
      )}
    >
      {stack.map((id) => {
        const active = isVideoActionActive(id, actions.state);
        return (
          <button
            key={id}
            type="button"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-black/65 shadow-sm backdrop-blur-sm transition hover:bg-black/85 focus-visible:opacity-100 disabled:opacity-50",
              active ? "text-[hsl(var(--primary))]" : "text-white",
            )}
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
    </div>
  );
}
