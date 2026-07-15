"use client";

import { trpc } from "@/trpc/react";

/**
 * Algorithm setting: keep channels you already subscribe to out of the
 * recommended feed. Your subscriptions still feed the algorithm as a taste
 * signal (they seed discovery of similar content) — only their own uploads are
 * held back, since those already live in the Subscriptions feed. Persists
 * immediately; the recommendation cache is keyed on the flag so the change
 * lands on the next feed load.
 */
export function ExcludeSubscribedToggle() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSettled: () => utils.settings.get.invalidate(),
  });

  const checked = settings.data?.excludeSubscribedFromRecommendations ?? true;
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
            excludeSubscribedFromRecommendations: e.currentTarget.checked,
          })
        }
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          Exclude channels I'm subscribed to
        </span>
        <span className="block text-sm text-[hsl(var(--muted-foreground))]">
          Hide uploads from channels you already follow — they stay in your
          Subscriptions feed. Your subscriptions still shape recommendations,
          surfacing similar videos from channels you don't yet follow.
        </span>
      </span>
    </label>
  );
}
