"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import { useVideoMembership } from "@/components/videos/video-membership-context";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type VideoCardOverlayActionsProps = {
  videoId?: string;
  title: string;
  channelId?: string;
  /** Positioning/layout classes for the button row. */
  className?: string;
};

/** One overlay icon button — consistent sizing, hover-reveal, and active colour. */
function OverlayButton({
  active,
  /** Keep the button visible (not just on hover) while active — for state, not one-shot actions. */
  persistWhenActive = false,
  activeClassName,
  disabled,
  onClick,
  title,
  label,
  children,
}: {
  active?: boolean;
  persistWhenActive?: boolean;
  activeClassName?: string;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  const visible = active && persistWhenActive;
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className={cn(
        "h-8 w-8 border text-white transition-[transform,opacity,background-color] duration-150 focus-visible:opacity-100",
        visible
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        active && activeClassName
          ? activeClassName
          : "border-white/20 bg-black/65 hover:bg-black/75",
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </Button>
  );
}

/**
 * Unified overlay action cluster for a video card: Save, Queue, Like, Dislike,
 * Mark-watched, and Ignore in a single aligned row. Save/Queue reflect shared
 * membership state and keep a colour + stay visible while active so it is clear
 * a video is saved or queued; the rest reveal on hover. Consolidating every
 * corner button here keeps sizing, spacing, and behaviour consistent.
 */
export function VideoCardOverlayActions({
  videoId,
  title,
  channelId,
  className,
}: VideoCardOverlayActionsProps) {
  const utils = trpc.useUtils();
  const { ignore } = useIgnoredVideos();
  const { saved, queued } = useVideoMembership(videoId);

  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [watched, setWatched] = useState(false);
  // Optimistic overrides so a click reflects instantly before the query settles.
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null);
  const [queuedOverride, setQueuedOverride] = useState<boolean | null>(null);
  const isSaved = savedOverride ?? saved;
  const isQueued = queuedOverride ?? queued;

  const setInteraction = trpc.interactions.set.useMutation();
  const markWatched = trpc.subscriptions.markWatched.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.subscriptions.mergedFeedInfinite.invalidate(),
        utils.feed.home.invalidate(),
        utils.video.related.invalidate(),
        utils.history.continueWatching.invalidate(),
      ]);
    },
  });
  const saveMutation = trpc.interactions.set.useMutation({
    onSettled: () => {
      setSavedOverride(null);
      return Promise.all([
        utils.interactions.savedIds.invalidate(),
        videoId ? utils.interactions.state.invalidate({ videoId }) : undefined,
      ]);
    },
  });
  const queueAdd = trpc.queue.add.useMutation({
    onSettled: () => {
      setQueuedOverride(null);
      return utils.queue.list.invalidate();
    },
  });
  const queueRemove = trpc.queue.remove.useMutation({
    onSettled: () => {
      setQueuedOverride(null);
      return utils.queue.list.invalidate();
    },
  });

  if (!videoId) return null;

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const toggleSave = (e: React.MouseEvent) => {
    stop(e);
    if (saveMutation.isPending) return;
    const next = !isSaved;
    setSavedOverride(next);
    saveMutation.mutate({
      videoId,
      channelId,
      type: "save",
      active: next,
      title,
    });
  };

  const toggleQueue = (e: React.MouseEvent) => {
    stop(e);
    if (queueAdd.isPending || queueRemove.isPending) return;
    const next = !isQueued;
    setQueuedOverride(next);
    if (next) queueAdd.mutate({ videoId, title, channelId });
    else queueRemove.mutate({ videoId });
  };

  const toggleReaction = async (
    e: React.MouseEvent,
    type: "like" | "dislike",
  ) => {
    stop(e);
    if (setInteraction.isPending) return;
    const isLike = type === "like";
    const next = isLike ? !liked : !disliked;
    if (isLike) {
      setLiked(next);
      if (next) setDisliked(false);
    } else {
      setDisliked(next);
      if (next) setLiked(false);
    }
    try {
      await setInteraction.mutateAsync({
        videoId,
        channelId,
        type,
        active: next,
      });
      if (next) {
        await setInteraction.mutateAsync({
          videoId,
          channelId,
          type: isLike ? "dislike" : "like",
          active: false,
        });
      }
      await Promise.all([
        utils.feed.home.invalidate(),
        utils.video.related.invalidate(),
      ]);
    } catch {
      if (isLike) setLiked((v) => !v);
      else setDisliked((v) => !v);
    }
  };

  const onMarkWatched = async (e: React.MouseEvent) => {
    stop(e);
    if (watched || markWatched.isPending) return;
    setWatched(true);
    try {
      await markWatched.mutateAsync({ videoId, channelId });
    } catch {
      setWatched(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1">
        <OverlayButton
          active={liked}
          activeClassName="border-rose-400/40 bg-rose-600 hover:bg-rose-600/90"
          onClick={(e) => toggleReaction(e, "like")}
          title="Like"
          label={liked ? "Liked" : "Like"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <title>Like</title>
            <path d="M9 21h8a2 2 0 0 0 2-1.6l1-5A2 2 0 0 0 18 12h-5l.7-3.3A2 2 0 0 0 11.8 6L9 9v12ZM4 10h3v11H4z" />
          </svg>
        </OverlayButton>
        <OverlayButton
          active={disliked}
          activeClassName="border-violet-400/40 bg-violet-600 hover:bg-violet-600/90"
          onClick={(e) => toggleReaction(e, "dislike")}
          title="Dislike"
          label={disliked ? "Disliked" : "Dislike"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <title>Dislike</title>
            <path d="M15 3H7a2 2 0 0 0-2 1.6l-1 5A2 2 0 0 0 6 12h5l-.7 3.3A2 2 0 0 0 12.2 18L15 15V3Zm5 1h-3v11h3z" />
          </svg>
        </OverlayButton>
        <OverlayButton
          disabled={watched || markWatched.isPending}
          onClick={onMarkWatched}
          title="Mark as watched"
          label={watched ? "Watched" : "Mark as watched"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <title>Mark as watched</title>
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        </OverlayButton>
        <OverlayButton
          onClick={(e) => {
            stop(e);
            ignore(videoId, channelId);
          }}
          title="Ignore (hide from feeds)"
          label="Ignore this video"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <title>Ignore</title>
            <circle cx="12" cy="12" r="9" />
            <path d="M5.6 5.6l12.8 12.8" />
          </svg>
        </OverlayButton>
      </div>
      <div className="flex gap-1">
        <OverlayButton
          active={isSaved}
          persistWhenActive
          activeClassName="border-emerald-400/40 bg-emerald-600 hover:bg-emerald-600/90"
          onClick={toggleSave}
          title={isSaved ? "Saved — click to remove" : "Save"}
          label={isSaved ? "Saved" : "Save"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <title>Save</title>
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
        </OverlayButton>
        <OverlayButton
          active={isQueued}
          persistWhenActive
          activeClassName="border-sky-400/40 bg-sky-600 hover:bg-sky-600/90"
          onClick={toggleQueue}
          title={isQueued ? "Queued — click to remove" : "Add to queue"}
          label={isQueued ? "Queued" : "Add to queue"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <title>Queue</title>
            <path
              d={
                isQueued
                  ? "M4 6h11M4 12h11M4 18h7M15 18l2 2 4-4"
                  : "M4 6h11M4 12h11M4 18h7M17 15v6M20 18h-6"
              }
            />
          </svg>
        </OverlayButton>
      </div>
    </div>
  );
}
