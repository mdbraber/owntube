"use client";

import { useEffect, useRef } from "react";
import type { SponsorBlockSegment } from "@/lib/sponsorblock";
import { decideSponsorBlockSkip } from "@/lib/sponsorblock";
import type { SponsorBlockPrefs } from "@/lib/sponsorblock-prefs";

type PlayerSeekAdapter = {
  currentTime: number;
  paused: boolean;
  seek: (seconds: number) => void;
};

export function useSponsorBlockAutoSkip(input: {
  adapter: PlayerSeekAdapter;
  segments: readonly SponsorBlockSegment[];
  prefs: SponsorBlockPrefs;
  isScrubbing: boolean;
  videoId: string;
}): void {
  const skippedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    skippedRef.current.clear();
  }, [input.videoId, input.segments.length]);

  const { currentTime, paused, seek } = input.adapter;

  useEffect(() => {
    const decision = decideSponsorBlockSkip({
      currentTime,
      segments: input.segments,
      skippedUuids: skippedRef.current,
      isScrubbing: input.isScrubbing,
      enabled: input.prefs.enabled,
      autoSkip: input.prefs.autoSkip,
      paused,
    });
    if (!decision) return;
    skippedRef.current.add(decision.segment.uuid);
    seek(decision.seekTo);
  }, [
    currentTime,
    paused,
    seek,
    input.isScrubbing,
    input.prefs.autoSkip,
    input.prefs.enabled,
    input.segments,
  ]);
}
