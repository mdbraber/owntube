"use client";

import { useMemo } from "react";
import type { SponsorBlockSegment } from "@/lib/sponsorblock";
import {
  readSponsorBlockPrefs,
  type SponsorBlockPrefs,
} from "@/lib/sponsorblock-prefs";
import { trpc } from "@/trpc/react";

type UseSponsorBlockSegmentsOptions = {
  videoId: string;
  durationSeconds?: number;
  enabled?: boolean;
  prefs?: SponsorBlockPrefs;
};

export function useSponsorBlockSegments({
  videoId,
  durationSeconds,
  enabled = true,
  prefs: prefsOverride,
}: UseSponsorBlockSegmentsOptions): {
  segments: SponsorBlockSegment[];
  isLoading: boolean;
  prefs: SponsorBlockPrefs;
} {
  const prefs = useMemo(
    () => prefsOverride ?? readSponsorBlockPrefs(),
    [prefsOverride],
  );

  const queryEnabled =
    enabled &&
    prefs.enabled &&
    videoId.length > 0 &&
    prefs.categories.length > 0;

  const query = trpc.sponsorblock.segments.useQuery(
    {
      videoId,
      categories: prefs.categories,
      durationSeconds:
        typeof durationSeconds === "number" &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
          ? durationSeconds
          : undefined,
    },
    {
      enabled: queryEnabled,
      staleTime: 600_000,
      retry: 1,
    },
  );

  return {
    segments: query.data ?? [],
    isLoading: query.isLoading,
    prefs,
  };
}
