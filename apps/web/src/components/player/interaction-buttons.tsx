"use client";

import { useEffect, useRef, useState } from "react";
import { ShareDialog } from "@/components/player/share-dialog";
import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  ChevronDownIcon,
  ShareIcon,
} from "@/components/videos/video-action-icons";
import {
  isVideoActionActive,
  type VideoActionId,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import {
  PlaylistPicker,
  VideoActionsMenu,
} from "@/components/videos/video-actions-menu";
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
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const actions = useVideoActions({
    videoId,
    channelId,
    channelName,
    title,
    surface: "watch",
    withInteractionState: isAuthenticated,
    loadPlaylists: saveMenuOpen,
  });
  const disabled = !isAuthenticated || actions.pending;
  const [shareOpen, setShareOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!saveMenuRef.current?.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSaveMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [saveMenuOpen]);

  // Saved is the *inbox*: the main button is a pure capture toggle. Filing
  // into playlists happens via the chevron picker (which moves it out of
  // the inbox); the playlist pill next to the row shows where it lives.
  const saveActive = actions.state.saved;
  const onSaveMainPress = () => actions.toggleSave();

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
      <div ref={saveMenuRef} className="relative">
        <div
          className={cn(
            "flex overflow-hidden rounded-full",
            saveActive
              ? "bg-[hsl(var(--primary)_/_0.12)]"
              : "bg-[hsl(var(--muted)_/_0.6)]",
          )}
        >
          <button
            type="button"
            className={cn(pillBase, "pl-4 pr-3", pillTone(saveActive))}
            disabled={disabled}
            aria-pressed={saveActive}
            title={saveActive ? "Saved — click to remove" : "Save"}
            onClick={onSaveMainPress}
          >
            <Glyph id="save" active={saveActive} />
            <span>{saveActive ? "Saved" : "Save"}</span>
          </button>
          <span
            aria-hidden
            className="my-2 w-px shrink-0 bg-[hsl(var(--border))]"
          />
          <button
            type="button"
            className={cn(pillBase, "px-2.5", pillTone(saveActive))}
            disabled={disabled}
            aria-label="Choose playlists"
            aria-expanded={saveMenuOpen}
            title="Save to Saved or playlists"
            onClick={() => setSaveMenuOpen((o) => !o)}
          >
            <ChevronDownIcon className="h-4 w-4" />
          </button>
        </div>
        {saveMenuOpen ? (
          <div
            role="dialog"
            aria-label="Save to"
            className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pt-2 text-sm shadow-lg"
          >
            <PlaylistPicker
              actions={actions}
              onBack={() => setSaveMenuOpen(false)}
              includeSaved
              title="Save to"
            />
          </div>
        ) : null}
      </div>
      {toggle("queue")}
      <ShareDialog
        videoId={videoId}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      {/* Where it lives long-term, at a glance. */}
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
        visibleActions={["watched", "save", "queue", "playlist"]}
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
