"use client";

import { useEffect } from "react";
import {
  writeWatchMiniEnabled,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";
import { trpc } from "@/trpc/react";

export function MiniPlayerSync() {
  const { data } = trpc.settings.get.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) return;
    const enabled = data.enableMiniPlayer ?? true;
    writeWatchMiniEnabled(enabled);
    if (!enabled) writeWatchMiniState(null);
  }, [data]);

  return null;
}
