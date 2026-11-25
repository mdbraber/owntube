"use client";

import { SectionOptionsMenu } from "@/components/library/section-options-menu";
import { trpc } from "@/trpc/react";

/**
 * The channel header's ⋯ menu: the channel pages' display options (size,
 * cards or list, rows, hide watched / ignored) and, once subscribed, Copy
 * RSS URL (the publisher only writes feeds for subscribed channels; this
 * shares the subscribe button's status query). Signed-in only.
 */
export function ChannelOptionsMenu({
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
  if (!isAuthed) return null;
  return (
    <SectionOptionsMenu
      section="channel"
      rssFeed={
        status.data?.subscribed
          ? { kind: "channel", refId: channelId }
          : undefined
      }
      buttonClassName="flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white"
    />
  );
}
