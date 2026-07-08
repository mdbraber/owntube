"use client";

import { useState } from "react";
import { ShareDialog } from "@/components/player/share-dialog";
import { useVideoActions } from "@/components/videos/use-video-actions";
import { ShareIcon } from "@/components/videos/video-action-icons";
import {
  isVideoActionActive,
  type VideoActionId,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import { VideoActionsMenu } from "@/components/videos/video-actions-menu";
import { VideoStatusPills } from "@/components/videos/video-status-pills";
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
  const [shareOpen, setShareOpen] = useState(false);

  const toggle = (id: "watched" | "save" | "queue") => {
    const active = isVideoActionActive(id, actions.state);
    const label =
      id === "watched"
        ? active
          ? "Watched"
          : "Mark watched"
        : videoActionShortLabel(id, actions.state);
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
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {toggle("watched")}
      {toggle("save")}
      {toggle("queue")}
      <ShareDialog
        videoId={videoId}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      {/* Playlist membership at a glance; queue/save state lives on the pills. */}
      <VideoStatusPills videoId={videoId} omit={["queued", "saved"]} />
      <VideoActionsMenu
        videoId={videoId}
        title={title}
        channelId={channelId}
        channelName={channelName}
        thumbnailUrl={thumbnailUrl}
        surface="watch"
        alwaysVisible
        // These are this row's own controls; reactions + Share live in the menu.
        visibleActions={["watched", "save", "queue"]}
        topItems={[
          {
            key: "share",
            label: "Share",
            icon: <ShareIcon />,
            onSelect: () => setShareOpen(true),
          },
        ]}
      />
    </div>
  );
}
