"use client";

import { useEffect, useRef, useState } from "react";
import { ShareDialog } from "@/components/player/share-dialog";
import { useActionToast } from "@/components/videos/action-toast";
import { useVideoActions } from "@/components/videos/use-video-actions";
import { ShareIcon } from "@/components/videos/video-action-icons";
import {
  isVideoActionActive,
  VideoActionGlyph,
  type VideoActionId,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import {
  PlaylistPicker,
  VideoActionsMenu,
} from "@/components/videos/video-actions-menu";
import { saveMembershipLabel } from "@/lib/save-membership";
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

  // One cue: the button label encodes membership (Save / Saved / <playlist
  // name> / Saved (n)). Inactive press = instant save to the inbox; active
  // press opens the picker where Saved + playlists are plain checkboxes.
  const membership = saveMembershipLabel(
    actions.state.saved,
    actions.playlistIds.size,
    actions.playlistName,
  );
  const { showToast } = useActionToast();
  const onSaveMainPress = () => {
    if (membership.active) {
      setSaveMenuOpen((o) => !o);
    } else {
      actions.toggleSave();
      // Quick capture confirmed; "Change" jumps straight into filing.
      showToast("Saved", {
        undo: () => setSaveMenuOpen(true),
        undoLabel: "Change",
      });
    }
  };

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
        className={cn(pillBase, "rounded-full px-3 sm:px-4", pillTone(active))}
        disabled={disabled}
        aria-pressed={active}
        title={actions.labelFor(id)}
        onClick={() => actions.runAction(id)}
      >
        <Glyph id={id} active={active} />
        {/* Icon-only below sm: three labeled pills overflow a phone row, and
            the kebab's sheet carries the labeled versions of every action. */}
        <span className="hidden sm:inline">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {toggle("watched")}
      <div ref={saveMenuRef} className="relative">
        <button
          type="button"
          className={cn(
            pillBase,
            "max-w-56 rounded-full px-3 sm:px-4",
            pillTone(membership.active),
          )}
          disabled={disabled}
          aria-pressed={membership.active}
          aria-expanded={saveMenuOpen}
          title={
            membership.active
              ? "Saved — click to choose where"
              : "Save for later"
          }
          onClick={onSaveMainPress}
        >
          <Glyph id="save" active={membership.active} />
          <span className="hidden truncate sm:inline">{membership.label}</span>
        </button>
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
