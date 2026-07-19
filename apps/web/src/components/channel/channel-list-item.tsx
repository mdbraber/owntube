"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { channelHref } from "@/lib/yt-routes";
import { formatSubscribersLabel } from "@/lib/video-display";

export type ChannelListItemData = {
  channelId: string;
  channelName: string;
  avatarUrl?: string | null;
  description?: string | null;
  subscriberCount?: number | null;
};

/**
 * Shared channel row: avatar, name, subscriber count, and a one-line
 * description. Used by the channels list and the "Similar channels" tab so both
 * read identically. Optional slots layer on surface-specific extras (tags,
 * last-upload meta, an unfollow button) without changing the core format.
 */
export function ChannelListItem({
  channel,
  metaRight,
  belowMeta,
  trailing,
}: {
  channel: ChannelListItemData;
  /** Right-aligned secondary meta, e.g. "Last video 2d ago" (hidden on mobile). */
  metaRight?: ReactNode;
  /** Rendered under the description, e.g. the inline tag editor. */
  belowMeta?: ReactNode;
  /** Trailing action(s), e.g. an unfollow button. */
  trailing?: ReactNode;
}) {
  const label = channel.channelName || channel.channelId;
  const href = channelHref(channel.channelId);
  const subs = formatSubscribersLabel(channel.subscriberCount ?? undefined);
  const description = channel.description?.trim();
  return (
    <div className="group flex items-center gap-3 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]">
      <Link href={href} className="shrink-0">
        <ChannelAvatarCircle
          imageUrl={channel.avatarUrl ?? undefined}
          label={label}
          size="lg"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link
            href={href}
            className="block min-w-0 truncate text-sm font-semibold text-[hsl(var(--foreground))] transition group-hover:text-[hsl(var(--primary))]"
          >
            {label}
          </Link>
          {subs ? (
            <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
              {subs}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
        ) : null}
        {belowMeta ? <div className="mt-1">{belowMeta}</div> : null}
      </div>
      {metaRight ? (
        <div className="hidden shrink-0 text-right text-xs text-[hsl(var(--muted-foreground))] sm:block">
          {metaRight}
        </div>
      ) : null}
      {trailing ?? null}
    </div>
  );
}
