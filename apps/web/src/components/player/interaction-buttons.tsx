"use client";

import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionId,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import { cn } from "@/lib/utils";

type InteractionButtonsProps = {
  videoId: string;
  channelId?: string;
  title: string;
  isAuthenticated: boolean;
};

const pillBase =
  "group relative flex items-center gap-2 overflow-hidden px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

function pillTone(active: boolean) {
  // App-wide active rule: neutral surface with a brand tint + filled glyph —
  // never a per-verb hue.
  return active
    ? "border-[hsl(var(--primary)_/_0.45)] bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]"
    : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.4)] hover:bg-[hsl(var(--primary)_/_0.08)]";
}

function PillGlyph({
  id,
  active,
}: {
  id: Exclude<VideoActionId, "playlist">;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "transition-transform duration-200 group-hover:scale-110",
        active ? "animate-[ot-pop_250ms_ease-out]" : "",
      )}
      aria-hidden="true"
    >
      <VideoActionGlyph id={id} active={active} />
    </span>
  );
}

/**
 * Watch-page action row — labeled pills rendered from the shared registry:
 * a segmented like/dislike pair (mutually exclusive verbs share one pill),
 * then Save and Queue toggles. Same state hook, icons, and active treatment
 * as the cards, rows, and sheets.
 */
export function InteractionButtons({
  videoId,
  channelId,
  title,
  isAuthenticated,
}: InteractionButtonsProps) {
  const actions = useVideoActions({
    videoId,
    channelId,
    title,
    surface: "watch",
    withInteractionState: isAuthenticated,
  });
  const disabled = !isAuthenticated || actions.pending;

  const reactionHalf = (id: "like" | "dislike") => {
    const active = isVideoActionActive(id, actions.state);
    return (
      <button
        type="button"
        className={cn(
          pillBase,
          "rounded-none border-0 shadow-none",
          pillTone(active),
          "hover:translate-y-0 hover:shadow-none",
        )}
        disabled={disabled}
        aria-pressed={active}
        onClick={() => actions.runAction(id)}
      >
        <PillGlyph id={id} active={active} />
        <span>{videoActionShortLabel(id, actions.state)}</span>
      </button>
    );
  };

  const toggle = (id: "save" | "queue") => {
    const active = isVideoActionActive(id, actions.state);
    return (
      <button
        type="button"
        className={cn(pillBase, "rounded-full border", pillTone(active))}
        disabled={disabled}
        aria-pressed={active}
        onClick={() => actions.runAction(id)}
      >
        <PillGlyph id={id} active={active} />
        <span>{videoActionShortLabel(id, actions.state)}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap gap-2.5">
      <div
        className={cn(
          "flex overflow-hidden rounded-full border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
          actions.state.liked || actions.state.disliked
            ? "border-[hsl(var(--primary)_/_0.45)]"
            : "border-[hsl(var(--border))]",
        )}
      >
        {reactionHalf("like")}
        <span
          aria-hidden
          className="my-2 w-px shrink-0 bg-[hsl(var(--border))]"
        />
        {reactionHalf("dislike")}
      </div>
      {toggle("save")}
      {toggle("queue")}
    </div>
  );
}
