"use client";

import type { VideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionId,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import { cn } from "@/lib/utils";

/**
 * Row of labeled quick-action chips (bottom sheet header row, watch page).
 * Active treatment follows the app-wide rule: neutral surface with a 10%
 * brand tint, filled glyph, brand text — never a full-color fill.
 * Consecutive like/dislike render as one segmented either-or pair.
 */

const chipBase =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[11px] font-semibold leading-none transition disabled:opacity-50";

function chipTone(active: boolean) {
  return active
    ? "bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]"
    : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]";
}

function chipBorder(active: boolean) {
  return active
    ? "border-[hsl(var(--primary)_/_0.4)]"
    : "border-[hsl(var(--border))]";
}

function Chip({
  id,
  actions,
  standalone = true,
}: {
  id: Exclude<VideoActionId, "playlist">;
  actions: VideoActions;
  standalone?: boolean;
}) {
  const active = isVideoActionActive(id, actions.state);
  return (
    <button
      type="button"
      className={cn(
        chipBase,
        chipTone(active),
        standalone && cn("rounded-xl border", chipBorder(active)),
        !active && standalone && "bg-[hsl(var(--muted)_/_0.5)]",
      )}
      disabled={actions.pending}
      aria-pressed={active}
      title={actions.labelFor(id)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        actions.runAction(id);
      }}
    >
      <VideoActionGlyph id={id} active={active} className="h-5 w-5" />
      <span className="max-w-full truncate">
        {videoActionShortLabel(id, actions.state)}
      </span>
    </button>
  );
}

/** One pill, two halves — like and dislike are mutually exclusive. */
function ReactionPairChip({ actions }: { actions: VideoActions }) {
  const anyActive = actions.state.liked || actions.state.disliked;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-[2] overflow-hidden rounded-xl border",
        anyActive ? chipBorder(true) : "border-[hsl(var(--border))]",
        "bg-[hsl(var(--muted)_/_0.5)]",
      )}
    >
      <Chip id="like" actions={actions} standalone={false} />
      <span
        aria-hidden
        className="my-2 w-px shrink-0 bg-[hsl(var(--border))]"
      />
      <Chip id="dislike" actions={actions} standalone={false} />
    </div>
  );
}

export function QuickActionChips({
  ids,
  actions,
  className,
}: {
  /** Ordered quick-action verbs (user preference), max 4 rendered. */
  ids: readonly Exclude<VideoActionId, "playlist">[];
  actions: VideoActions;
  className?: string;
}) {
  const shown = ids.slice(0, 4);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < shown.length; i++) {
    const id = shown[i];
    const next = shown[i + 1];
    // Merge adjacent like/dislike (either order) into one segmented pair.
    if (
      (id === "like" && next === "dislike") ||
      (id === "dislike" && next === "like")
    ) {
      nodes.push(<ReactionPairChip key="reaction-pair" actions={actions} />);
      i++;
      continue;
    }
    nodes.push(<Chip key={id} id={id} actions={actions} />);
  }
  if (nodes.length === 0) return null;
  return <div className={cn("flex gap-2", className)}>{nodes}</div>;
}
