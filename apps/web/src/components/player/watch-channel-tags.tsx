"use client";

import Link from "next/link";
import { trpc } from "@/trpc/react";

type WatchChannelTagsProps = {
  channelId: string;
  isAuthenticated: boolean;
};

/**
 * The user's tags for this video's channel, shown under the channel name on
 * the watch page. Each tag links to the subscriptions feed filtered to it
 * (/subscriptions?tag=…, which the feed reads as an include filter). Renders
 * nothing when signed out or the channel is untagged.
 */
export function WatchChannelTags({
  channelId,
  isAuthenticated,
}: WatchChannelTagsProps) {
  const tagsQuery = trpc.channelTags.listForChannel.useQuery(
    { channelId },
    { enabled: isAuthenticated },
  );
  const tags = tagsQuery.data ?? [];
  if (tags.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Link
          key={tag}
          href={`/subscriptions?tag=${encodeURIComponent(tag)}`}
          className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-px text-[11px] font-medium text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]"
          title={`Show subscriptions tagged "${tag}"`}
        >
          {tag}
        </Link>
      ))}
    </span>
  );
}
