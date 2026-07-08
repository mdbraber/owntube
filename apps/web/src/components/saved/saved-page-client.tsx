"use client";

import {
  SectionOptionsMenu,
  useSectionPagePrefs,
} from "@/components/library/section-options-menu";
import { useWatchProgressMap } from "@/components/videos/video-membership-context";
import { VideoRow } from "@/components/videos/video-row";
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
    onSettled: () =>
      Promise.all([
        utils.interactions.listSaved.invalidate(),
        utils.interactions.savedIds.invalidate(),
      ]),
  });

  const prefs = useSectionPagePrefs("saved");
  const progressMap = useWatchProgressMap();
  const allItems = savedQuery.data ?? [];
  const items = prefs.hideCompleted
    ? allItems.filter((item) => {
        const p = progressMap.get(item.videoId);
        // YouTube-style: near-finished (≥90%) counts as watched.
        return !p || (!p.completed && p.fraction < 0.9);
      })
    : allItems;

  if (!savedQuery.isLoading && items.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        You have not saved any videos yet. Press <strong>Save</strong> on a
        video to keep it here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <SectionOptionsMenu section="saved" />
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.videoId}>
            <VideoRow
              videoId={item.videoId}
              title={item.videoTitle}
              channelId={item.channelId}
              channelName={item.channelName}
              thumbnailUrl={item.thumbnailUrl}
              durationSeconds={item.durationSeconds}
              surface="saved"
              size={prefs.rowSize}
              removeLabel="Remove from saved"
              removeDisabled={unsave.isPending}
              onRemove={() =>
                unsave.mutate({
                  videoId: item.videoId,
                  type: "save",
                  active: false,
                })
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
