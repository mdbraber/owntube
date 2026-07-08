import type { ReactNode } from "react";
import {
  BlockChannelIcon,
  DislikeIcon,
  IgnoreIcon,
  LikeIcon,
  PlaylistIcon,
  QueuedIcon,
  QueueIcon,
  SavedIcon,
  SaveIcon,
  WatchedIcon,
} from "@/components/videos/video-action-icons";

/**
 * Single source of truth for video action verbs: every surface (kebab menu,
 * bottom sheet, quick-action chips, thumbnail buttons, swipe underlays, watch
 * page) renders from this registry so an action always has the same label,
 * icon, and placement — defined once, changed once.
 */

export type VideoActionId =
  | "queue"
  | "save"
  | "playlist"
  | "like"
  | "dislike"
  | "watched"
  | "ignore"
  | "block-channel";

/** Where the action list is being rendered — trims the menu per context. */
export type VideoActionSurface =
  | "feed" // Home / Explore / Trending / Search
  | "subscriptions"
  | "channel"
  | "related"
  | "shorts"
  | "queue"
  | "history"
  | "saved"
  | "watch";

export type VideoActionState = {
  queued: boolean;
  saved: boolean;
  liked: boolean;
  disliked: boolean;
  watched: boolean;
  channelBlocked: boolean;
};

/**
 * Fixed group order so future actions have an obvious home:
 * collection → feedback → library → destructive (always last).
 * Groups render with separators between them.
 */
const BASE_GROUPS: VideoActionId[][] = [
  ["queue", "save", "playlist"],
  ["like", "dislike"],
  ["watched"],
  ["ignore", "block-channel"],
];

/** Actions that make no sense on a given surface. */
function isHiddenOn(id: VideoActionId, surface: VideoActionSurface): boolean {
  switch (id) {
    case "watched":
      // Already watched (history) or being watched (watch page).
      return surface === "history" || surface === "watch";
    case "block-channel":
      // The user deliberately follows this channel here.
      return surface === "subscriptions" || surface === "channel";
    case "ignore":
      // Library pages: removal is the row's own affordance, not "hide from feeds".
      return (
        surface === "queue" || surface === "history" || surface === "saved"
      );
    default:
      return false;
  }
}

export function videoActionGroupsForSurface(
  surface: VideoActionSurface,
): VideoActionId[][] {
  return BASE_GROUPS.map((group) =>
    group.filter((id) => !isHiddenOn(id, surface)),
  ).filter((group) => group.length > 0);
}

export function videoActionLabel(
  id: VideoActionId,
  state: VideoActionState,
  surface: VideoActionSurface,
): string {
  switch (id) {
    case "queue":
      if (surface === "queue") return "Remove from queue";
      return state.queued ? "Remove from queue" : "Add to queue";
    case "save":
      return state.saved ? "Remove from saved" : "Save";
    case "playlist":
      return "Add to playlist";
    case "like":
      return state.liked ? "Liked" : "Like";
    case "dislike":
      return state.disliked ? "Disliked" : "Dislike";
    case "watched":
      return state.watched ? "Marked as watched" : "Mark as watched";
    case "ignore":
      return "Ignore this video";
    case "block-channel":
      return "Don't recommend channel";
  }
}

/** Short label for compact surfaces (chips, thumbnail button tooltips). */
export function videoActionShortLabel(
  id: VideoActionId,
  state: VideoActionState,
): string {
  switch (id) {
    case "queue":
      return state.queued ? "Queued" : "Queue";
    case "save":
      return state.saved ? "Saved" : "Save";
    case "playlist":
      return "Playlist";
    case "like":
      return state.liked ? "Liked" : "Like";
    case "dislike":
      return state.disliked ? "Disliked" : "Dislike";
    case "watched":
      return state.watched ? "Watched" : "Watched";
    case "ignore":
      return "Ignore";
    case "block-channel":
      return "Block";
  }
}

export function isVideoActionActive(
  id: VideoActionId,
  state: VideoActionState,
): boolean {
  switch (id) {
    case "queue":
      return state.queued;
    case "save":
      return state.saved;
    case "like":
      return state.liked;
    case "dislike":
      return state.disliked;
    case "watched":
      return state.watched;
    case "block-channel":
      return state.channelBlocked;
    default:
      return false;
  }
}

/**
 * The one icon per verb; active toggles swap to the filled variant (the icon
 * carries the "on" state — surfaces stay neutral with at most a brand tint).
 */
export function VideoActionGlyph({
  id,
  active = false,
  className,
}: {
  id: VideoActionId;
  active?: boolean;
  className?: string;
}) {
  const props = className ? { className } : {};
  let icon: ReactNode;
  switch (id) {
    case "queue":
      icon = active ? <QueuedIcon {...props} /> : <QueueIcon {...props} />;
      break;
    case "save":
      icon = active ? <SavedIcon {...props} /> : <SaveIcon {...props} />;
      break;
    case "playlist":
      icon = <PlaylistIcon {...props} />;
      break;
    case "like":
      icon = <LikeIcon {...props} />;
      break;
    case "dislike":
      icon = <DislikeIcon {...props} />;
      break;
    case "watched":
      icon = <WatchedIcon {...props} />;
      break;
    case "ignore":
      icon = <IgnoreIcon {...props} />;
      break;
    case "block-channel":
      icon = <BlockChannelIcon {...props} />;
      break;
  }
  return icon;
}
