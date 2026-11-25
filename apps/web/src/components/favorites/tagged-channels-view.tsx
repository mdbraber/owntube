"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SubscriptionVideosInfinite } from "@/components/subscriptions/subscription-videos-infinite";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import type { TagFeedFilter } from "@/lib/home-blocks";
import { trpc } from "@/trpc/react";

/**
 * Favorites and tag pages: the matching channels as a strip of avatars for
 * quick access, then their merged uploads.
 */
export function TaggedChannelsView({
  filter,
  empty,
  section,
}: {
  filter: TagFeedFilter;
  /** Whose ⋯ options the feed uses. */
  section: "favorites" | "tags";
  /** Shown instead of the feed when no subscribed channel matches. */
  empty: ReactNode;
}) {
  const channels = trpc.subscriptions.listTagged.useQuery(filter, {
    staleTime: 60_000,
  });

  if (channels.isPending) {
    return (
      <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">
        Loading…
      </p>
    );
  }
  if ((channels.data ?? []).length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] px-6 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {(channels.data ?? []).map((c) => (
          <li key={c.channelId} className="shrink-0 snap-start">
            <Link
              href={`/channel/${encodeURIComponent(c.channelId)}`}
              className="group flex w-24 flex-col items-center gap-2 rounded-[var(--radius-card)] p-2 text-center transition hover:bg-[hsl(var(--muted)_/_0.45)]"
              title={c.channelName}
            >
              <ChannelAvatarCircle
                imageUrl={c.avatarUrl ?? undefined}
                label={c.channelName}
                size="lg"
              />
              <span className="line-clamp-2 text-xs font-medium leading-snug transition group-hover:text-[hsl(var(--primary))]">
                {c.channelName}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <SubscriptionVideosInfinite
        includeTags={filter.includeTags ?? []}
        excludeTags={filter.excludeTags ?? []}
        tagMatch={filter.tagMatch}
        favorites={filter.favorites}
        section={section}
      />
    </div>
  );
}
