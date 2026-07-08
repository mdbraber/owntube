"use client";

import { useActionToast } from "@/components/videos/action-toast";
import { BlockChannelIcon } from "@/components/videos/video-action-icons";
import { trpc } from "@/trpc/react";

type Props = {
  channelId: string;
  isAuthed: boolean;
};

/**
 * Channel-header pill shown when the channel is excluded from
 * recommendations ("Don't recommend channel"). Click to lift the block.
 */
export function ChannelBlockedBadge({ channelId, isAuthed }: Props) {
  const utils = trpc.useUtils();
  const { showToast } = useActionToast();
  const settings = trpc.settings.get.useQuery(undefined, {
    enabled: isAuthed,
    retry: false,
  });
  const invalidate = () =>
    Promise.all([
      utils.settings.get.invalidate(),
      utils.video.related.invalidate(),
      utils.feed.home.invalidate(),
    ]);
  const unblock = trpc.interactions.unblockRecommendationChannel.useMutation({
    onSuccess: invalidate,
  });
  const block = trpc.interactions.blockRecommendationChannel.useMutation({
    onSuccess: invalidate,
  });

  const blocked =
    settings.data?.blockedRecommendationChannels.includes(channelId) ?? false;
  if (!isAuthed || !blocked) return null;

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.25)] px-2.5 py-1 font-medium text-white transition hover:bg-[hsl(var(--primary)_/_0.4)]"
      title="Excluded from recommendations — click to allow again"
      disabled={unblock.isPending}
      onClick={() => {
        unblock.mutate({ channelId });
        showToast("Channel allowed in recommendations again", {
          undo: () => block.mutate({ channelId }),
        });
      }}
    >
      <BlockChannelIcon className="h-3.5 w-3.5" />
      Not recommended
    </button>
  );
}
