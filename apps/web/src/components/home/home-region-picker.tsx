"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { TRENDING_REGION_OPTIONS } from "@/lib/trending-regions";
import { trpc } from "@/trpc/react";

type HomeRegionPickerProps = {
  effectiveRegion: string;
  isAuthed: boolean;
};

export function HomeRegionPicker({
  effectiveRegion,
  isAuthed,
}: HomeRegionPickerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const utils = trpc.useUtils();
  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
      await utils.feed.home.invalidate();
      await utils.trending.list.invalidate();
    },
  });

  const known = TRENDING_REGION_OPTIONS.some((o) => o.code === effectiveRegion);
  const options = known
    ? TRENDING_REGION_OPTIONS
    : [
        { code: effectiveRegion, label: effectiveRegion },
        ...TRENDING_REGION_OPTIONS,
      ];

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-[hsl(var(--muted-foreground))]">
        Trending region
      </span>
      <select
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 font-mono text-xs"
        value={effectiveRegion}
        disabled={pending || updateSettings.isPending}
        onChange={(e) => {
          const code = e.target.value.trim().toUpperCase();
          if (code.length !== 2) return;
          startTransition(() => {
            router.replace(`/?region=${encodeURIComponent(code)}`);
            if (isAuthed) {
              void updateSettings.mutateAsync({ trendingRegion: code });
            }
          });
        }}
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label} ({o.code})
          </option>
        ))}
      </select>
    </label>
  );
}
