"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Favorite</title>
      <path d="m12 3.2 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z" />
    </svg>
  );
}

/**
 * Star a channel for quick access under Favorites. Starring tags it with the
 * favorite tag (settings) and subscribes if needed; unstarring only drops
 * the tag. Renders nothing when signed out.
 */
export function ChannelFavoriteButton({
  channelId,
  isAuthed,
  className,
}: {
  channelId: string;
  isAuthed: boolean;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const status = trpc.favorites.status.useQuery(
    { channelId },
    { enabled: isAuthed },
  );
  const set = trpc.favorites.set.useMutation({
    onMutate: async ({ favorite }) => {
      await utils.favorites.status.cancel({ channelId });
      const previous = utils.favorites.status.getData({ channelId });
      if (previous) {
        utils.favorites.status.setData(
          { channelId },
          { ...previous, favorite },
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        utils.favorites.status.setData({ channelId }, context.previous);
      }
    },
    onSettled: async () => {
      await Promise.all([
        utils.favorites.invalidate(),
        utils.subscriptions.invalidate(),
        utils.channelTags.invalidate(),
      ]);
    },
  });

  if (!isAuthed || !status.data) return null;
  const favorite = status.data.favorite;
  const label = favorite ? "Remove from favorites" : "Add to favorites";

  // Same shape as the Subscribe button next to it, with a label: the bare
  // outlined star was easy to miss. Active stays the same white button;
  // only the star fills in.
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-pressed={favorite}
      title={`${label} (#${status.data.tag})`}
      disabled={set.isPending}
      className={className}
      onClick={() => set.mutate({ channelId, favorite: !favorite })}
    >
      <span className={cn("inline-flex", favorite ? "text-amber-500" : "")}>
        <StarIcon filled={favorite} />
      </span>
      {favorite ? "Favorited" : "Favorite"}
    </Button>
  );
}
