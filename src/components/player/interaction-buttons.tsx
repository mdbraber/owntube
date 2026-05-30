"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type InteractionButtonsProps = {
  videoId: string;
  channelId?: string;
  isAuthenticated: boolean;
};

function LikeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1 1 0 0 0-.29-.7L13.17 1 7.59 6.59A2 2 0 0 0 7 8v10a2 2 0 0 0 2 2h8a2 2 0 0 0 1.9-1.37l3-9c.07-.2.1-.41.1-.63V10z" />
    </svg>
  );
}

function DislikeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M22 3h-4v12h4V3zM2 14a2 2 0 0 0 2 2h6.31l-.95 4.57-.03.32c0 .26.11.52.29.7L10.83 23l5.58-5.59A2 2 0 0 0 17 16V6a2 2 0 0 0-2-2H7a2 2 0 0 0-1.9 1.37l-3 9c-.07.2-.1.41-.1.63z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function InteractionButtons({
  videoId,
  channelId,
  isAuthenticated,
}: InteractionButtonsProps) {
  const utils = trpc.useUtils();
  const stateQuery = trpc.interactions.state.useQuery(
    { videoId },
    { enabled: isAuthenticated },
  );
  const setMutation = trpc.interactions.set.useMutation({
    onSuccess: async () => {
      await utils.interactions.state.invalidate({ videoId });
    },
  });

  const state = useMemo(
    () => stateQuery.data ?? { like: false, dislike: false, save: false },
    [stateQuery.data],
  );
  const isPending = setMutation.isPending;

  const fancyButtonClass =
    "group relative overflow-hidden rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]";

  return (
    <div className="flex flex-wrap gap-2.5">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          fancyButtonClass,
          state.like
            ? "border-rose-500/45 bg-rose-500/15 text-rose-600 dark:text-rose-400"
            : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-rose-400/50 hover:bg-rose-500/10",
        )}
        disabled={!isAuthenticated || isPending}
        onClick={() =>
          setMutation.mutate({
            videoId,
            channelId,
            type: "like",
            active: !state.like,
          })
        }
      >
        <span
          className={cn(
            "transition-transform duration-200 group-hover:scale-110",
            state.like ? "animate-[ot-pop_250ms_ease-out]" : "",
          )}
          aria-hidden
        >
          <LikeIcon />
        </span>
        <span>{state.like ? "Liked" : "Like"}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          fancyButtonClass,
          state.dislike
            ? "border-violet-500/45 bg-violet-500/15 text-violet-600 dark:text-violet-400"
            : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-violet-400/50 hover:bg-violet-500/10",
        )}
        disabled={!isAuthenticated || isPending}
        onClick={() =>
          setMutation.mutate({
            videoId,
            channelId,
            type: "dislike",
            active: !state.dislike,
          })
        }
      >
        <span
          className={cn(
            "transition-transform duration-200 group-hover:scale-110",
            state.dislike ? "animate-[ot-pop_250ms_ease-out]" : "",
          )}
          aria-hidden
        >
          <DislikeIcon />
        </span>
        <span>{state.dislike ? "Disliked" : "Dislike"}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          fancyButtonClass,
          state.save
            ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-emerald-400/50 hover:bg-emerald-500/10",
        )}
        disabled={!isAuthenticated || isPending}
        onClick={() =>
          setMutation.mutate({
            videoId,
            channelId,
            type: "save",
            active: !state.save,
          })
        }
      >
        <span
          className={cn(
            "transition-transform duration-200 group-hover:scale-110",
            state.save ? "animate-[ot-pop_250ms_ease-out]" : "",
          )}
          aria-hidden
        >
          <SaveIcon />
        </span>
        <span>{state.save ? "Saved" : "Save"}</span>
      </Button>
      <style jsx>{`
        @keyframes ot-pop {
          0% { transform: scale(0.9); }
          60% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
