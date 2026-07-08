"use client";

import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionId,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import { VideoActionsMenu } from "@/components/videos/video-actions-menu";
import { cn } from "@/lib/utils";

type InteractionButtonsProps = {
  videoId: string;
  channelId?: string;
  channelName?: string;
  title: string;
  thumbnailUrl?: string;
  isAuthenticated: boolean;
};

const pillBase =
  "flex h-9 items-center gap-2 text-sm font-semibold transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

function pillTone(active: boolean) {
  // App-wide active rule: neutral surface with a brand tint + filled glyph.
  return active
    ? "bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]"
    : "bg-[hsl(var(--muted)_/_0.6)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]";
}

function Glyph({
  id,
  active,
}: {
  id: Exclude<VideoActionId, "playlist">;
  active: boolean;
}) {
  return (
    <span
      className={cn(active ? "animate-[ot-pop_250ms_ease-out]" : "")}
      aria-hidden="true"
    >
      <VideoActionGlyph id={id} active={active} />
    </span>
  );
}

/**
 * Watch-page action row in the shared system: an icon-only segmented
 * like/dislike pair (either-or verbs share one pill; glyphs read without
 * labels), Save and Queue toggles, and the complete context-aware kebab so
 * every action (playlist, watched, ignore, block) is reachable here too.
 */
export function InteractionButtons({
  videoId,
  channelId,
  channelName,
  title,
  thumbnailUrl,
  isAuthenticated,
}: InteractionButtonsProps) {
  const actions = useVideoActions({
    videoId,
    channelId,
    channelName,
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
        className={cn(pillBase, "px-3.5", pillTone(active))}
        disabled={disabled}
        aria-pressed={active}
        aria-label={actions.labelFor(id)}
        title={actions.labelFor(id)}
        onClick={() => actions.runAction(id)}
      >
        <Glyph id={id} active={active} />
      </button>
    );
  };

  const toggle = (id: "save" | "queue") => {
    const active = isVideoActionActive(id, actions.state);
    return (
      <button
        type="button"
        className={cn(pillBase, "rounded-full px-4", pillTone(active))}
        disabled={disabled}
        aria-pressed={active}
        title={actions.labelFor(id)}
        onClick={() => actions.runAction(id)}
      >
        <Glyph id={id} active={active} />
        <span>{videoActionShortLabel(id, actions.state)}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Segmented either-or pair; each half carries its own aria-label. */}
      <div className="flex overflow-hidden rounded-full">
        {reactionHalf("like")}
        <span
          aria-hidden
          className="my-2 w-px shrink-0 bg-[hsl(var(--border))]"
        />
        {reactionHalf("dislike")}
      </div>
      {toggle("save")}
      {toggle("queue")}
      <VideoActionsMenu
        videoId={videoId}
        title={title}
        channelId={channelId}
        channelName={channelName}
        thumbnailUrl={thumbnailUrl}
        surface="watch"
        alwaysVisible
      />
    </div>
  );
}
