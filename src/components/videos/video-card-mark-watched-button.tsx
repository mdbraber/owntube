"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

type VideoCardMarkWatchedButtonProps = {
  videoId?: string;
  channelId?: string;
  className?: string;
};

export function VideoCardMarkWatchedButton({
  videoId,
  channelId,
  className,
}: VideoCardMarkWatchedButtonProps) {
  const utils = trpc.useUtils();
  const [animLike, setAnimLike] = useState(false);
  const [animDislike, setAnimDislike] = useState(false);
  const [animWatched, setAnimWatched] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [done, setDone] = useState(false);
  const setInteractionMutation = trpc.interactions.set.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.feed.home.invalidate(),
        utils.video.related.invalidate(),
      ]);
    },
  });
  const mutation = trpc.subscriptions.markWatched.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.subscriptions.mergedFeedInfinite.invalidate(),
        utils.feed.home.invalidate(),
        utils.video.related.invalidate(),
      ]);
    },
  });

  if (!videoId) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        variant={liked ? "default" : "secondary"}
        size="icon"
        className={`h-8 w-8 border border-white/20 bg-black/65 text-white transition-transform duration-150 hover:bg-black/75 ${animLike ? "scale-110" : "scale-100"}`}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (setInteractionMutation.isPending) return;
          setAnimLike(true);
          window.setTimeout(() => setAnimLike(false), 150);
          const nextLiked = !liked;
          setLiked(nextLiked);
          if (nextLiked) setDisliked(false);
          try {
            await setInteractionMutation.mutateAsync({
              videoId,
              channelId,
              type: "like",
              active: nextLiked,
            });
            if (nextLiked) {
              await setInteractionMutation.mutateAsync({
                videoId,
                channelId,
                type: "dislike",
                active: false,
              });
            }
          } catch {
            setLiked((v) => !v);
          }
        }}
        title="Like"
        aria-label={liked ? "Liked" : "Like"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M9 21h8a2 2 0 0 0 2-1.6l1-5A2 2 0 0 0 18 12h-5l.7-3.3A2 2 0 0 0 11.8 6L9 9v12ZM4 10h3v11H4z" />
        </svg>
      </Button>
      <Button
        type="button"
        variant={disliked ? "default" : "secondary"}
        size="icon"
        className={`h-8 w-8 border border-white/20 bg-black/65 text-white transition-transform duration-150 hover:bg-black/75 ${animDislike ? "scale-110" : "scale-100"}`}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (setInteractionMutation.isPending) return;
          setAnimDislike(true);
          window.setTimeout(() => setAnimDislike(false), 150);
          const nextDisliked = !disliked;
          setDisliked(nextDisliked);
          if (nextDisliked) setLiked(false);
          try {
            await setInteractionMutation.mutateAsync({
              videoId,
              channelId,
              type: "dislike",
              active: nextDisliked,
            });
            if (nextDisliked) {
              await setInteractionMutation.mutateAsync({
                videoId,
                channelId,
                type: "like",
                active: false,
              });
            }
          } catch {
            setDisliked((v) => !v);
          }
        }}
        title="Dislike"
        aria-label={disliked ? "Disliked" : "Dislike"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M15 3H7a2 2 0 0 0-2 1.6l-1 5A2 2 0 0 0 6 12h5l-.7 3.3A2 2 0 0 0 12.2 18L15 15V3Zm5 1h-3v11h3z" />
        </svg>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className={`h-8 w-8 border border-white/20 bg-black/65 text-white transition-transform duration-150 hover:bg-black/75 ${animWatched ? "scale-110" : "scale-100"}`}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (done || mutation.isPending) return;
          setAnimWatched(true);
          window.setTimeout(() => setAnimWatched(false), 150);
          setDone(true);
          try {
            await mutation.mutateAsync({ videoId, channelId });
          } catch {
            setDone(false);
          }
        }}
        disabled={done || mutation.isPending}
        title="Mark as watched"
        aria-label={done ? "Watched" : "Mark as watched"}
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
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      </Button>
    </div>
  );
}
