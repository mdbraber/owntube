"use client";

import { CopyRssUrlButton } from "@/components/feeds/copy-rss-url";
import { trpc } from "@/trpc/react";

/**
 * ⋯ menu in the channel header with Copy RSS URL. The publisher only writes
 * feeds for subscribed channels, so it shows only once subscribed (sharing
 * the subscribe button's status query).
 */
export function ChannelRssButton({
  channelId,
  isAuthed,
}: {
  channelId: string;
  isAuthed: boolean;
}) {
  const status = trpc.subscriptions.status.useQuery(
    { channelId },
    { enabled: isAuthed },
  );
  if (!status.data?.subscribed) return null;
  return (
    <CopyRssUrlButton
      kind="channel"
      refId={channelId}
      trigger="more"
      buttonClassName="flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white"
    />
  );
}
