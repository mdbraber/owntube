"use client";

import { LibraryVideoRow } from "@/components/library/library-video-row";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

export function SavedPageClient() {
  const utils = trpc.useUtils();
  const savedQuery = trpc.interactions.listSaved.useQuery();
  const unsave = trpc.interactions.set.useMutation({
    onMutate: async ({ videoId }) => {
      await utils.interactions.listSaved.cancel();
      const prev = utils.interactions.listSaved.getData();
      utils.interactions.listSaved.setData(undefined, (o) =>
        (o ?? []).filter((i) => i.videoId !== videoId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.interactions.listSaved.setData(undefined, ctx.prev);
    },
    onSettled: () => utils.interactions.listSaved.invalidate(),
  });

  const items = savedQuery.data ?? [];

  if (!savedQuery.isLoading && items.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        You have not saved any videos yet. Press <strong>Save</strong> on a
        video to keep it here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.videoId}>
          <LibraryVideoRow
            videoId={item.videoId}
            title={item.videoTitle}
            channelId={item.channelId}
            channelName={item.channelName}
            thumbnailUrl={item.thumbnailUrl}
            trailing={
              <Button
                variant="outline"
                onClick={() =>
                  unsave.mutate({
                    videoId: item.videoId,
                    type: "save",
                    active: false,
                  })
                }
                disabled={unsave.isPending}
              >
                Remove
              </Button>
            }
          />
        </li>
      ))}
    </ul>
  );
}
