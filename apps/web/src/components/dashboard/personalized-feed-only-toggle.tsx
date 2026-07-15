"use client";

import { trpc } from "@/trpc/react";

/**
 * Algorithm setting: make the recommended feed purely personalized by dropping
 * the regional-trending tail. The pool digs deeper into related videos to make
 * up the length, so you get more discovery instead of trending filler. Persists
 * immediately; the recommendation cache is keyed on the flag so the change
 * lands on the next feed load.
 */
export function PersonalizedFeedOnlyToggle() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSettled: () =>
      Promise.all([
        utils.settings.get.invalidate(),
        // Restructures the feed (tail on/off), so refresh it right away.
        utils.feed.home.invalidate(),
      ]),
  });

  const checked = settings.data?.personalizedFeedOnly ?? true;
  const disabled = settings.isPending || update.isPending;

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={disabled}
        onChange={(e) =>
          update.mutate({
            personalizedFeedOnly: e.currentTarget.checked,
          })
        }
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          Personalized picks only (no trending)
        </span>
        <span className="block text-sm text-[hsl(var(--muted-foreground))]">
          Drop the regional-trending tail from the recommended feed. The feed
          digs deeper into videos related to what you watch and like, so you get
          more discovery instead of trending filler.
        </span>
      </span>
    </label>
  );
}
