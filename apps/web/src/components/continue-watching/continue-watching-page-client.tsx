"use client";

import { LibraryVideoRow } from "@/components/library/library-video-row";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/video-display";
import { trpc } from "@/trpc/react";

export function ContinueWatchingPageClient() {
  const utils = trpc.useUtils();
  const query = trpc.history.continueWatching.useQuery({ limit: 50 });
  const dismiss = trpc.history.softDelete.useMutation({
    onMutate: async ({ id }) => {
      await utils.history.continueWatching.cancel();
      const prev = utils.history.continueWatching.getData();
      utils.history.continueWatching.setData({ limit: 50 }, (old) =>
        (old ?? []).filter((i) => i.id !== id),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev)
        utils.history.continueWatching.setData({ limit: 50 }, ctx.prev);
    },
    onSettled: () => utils.history.continueWatching.invalidate(),
  });

  const items = query.data ?? [];

  if (!query.isLoading && items.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Nothing to resume yet. Videos you start but do not finish show up here
        so you can pick up where you left off.
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
            href={item.href}
            progress={
              item.videoDurationSeconds > 0
                ? item.durationWatched / item.videoDurationSeconds
                : undefined
            }
            meta={
              item.videoDurationSeconds > 0 ? (
                <span className="tabular-nums">
                  {formatDuration(item.durationWatched)} /{" "}
                  {formatDuration(item.videoDurationSeconds)}
                </span>
              ) : null
            }
            trailing={
              <Button
                variant="outline"
                onClick={() => dismiss.mutate({ id: item.id })}
                disabled={dismiss.isPending}
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
