"use client";

import { useCallback, useRef, useState } from "react";
import type { AppSettings } from "@/server/settings/profile";
import { trpc } from "@/trpc/react";

export type SettingsPatch = Partial<AppSettings>;
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Reads the account settings and saves changes as they're made: a patch shows
 * at once (optimistic `settings.get`), goes to the server, and the server's
 * answer replaces it once no other save is in flight (so a quick second
 * change isn't undone by the first one's reply). A failed save refetches.
 */
export function useSettingsPatch({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const utils = trpc.useUtils();
  const query = trpc.settings.get.useQuery(undefined, {
    staleTime: 60_000,
    enabled,
  });
  const inFlight = useRef(0);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync } = trpc.settings.update.useMutation();

  const save = useCallback(
    async (patch: SettingsPatch) => {
      utils.settings.get.setData(undefined, (old) =>
        old ? { ...old, ...patch } : old,
      );
      inFlight.current += 1;
      setState("saving");
      setError(null);
      try {
        let data: AppSettings;
        try {
          data = await mutateAsync(patch);
        } finally {
          inFlight.current -= 1;
        }
        if (inFlight.current === 0) {
          utils.settings.get.setData(undefined, (old) =>
            old ? { ...data, instanceSources: old.instanceSources } : old,
          );
          setState("saved");
        }
        if (patch.favoriteTag !== undefined) {
          void utils.favorites.invalidate();
          void utils.subscriptions.listTagged.invalidate();
        }
        if (patch.hideShortsInSubscriptions !== undefined) {
          void utils.subscriptions.mergedFeedInfinite.invalidate();
        }
        if (patch.trendingRegion !== undefined) {
          void utils.feed.home.invalidate();
          void utils.trending.list.invalidate();
        }
      } catch (e) {
        setState("error");
        setError(e instanceof Error ? e.message : String(e));
        void utils.settings.get.invalidate();
      }
    },
    [mutateAsync, utils],
  );

  return { settings: query.data, save, state, error };
}
