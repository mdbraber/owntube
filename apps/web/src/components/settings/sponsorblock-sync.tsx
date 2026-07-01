"use client";

import { useEffect } from "react";
import {
  sponsorBlockPrefsFromAppSettings,
  writeSponsorBlockPrefs,
} from "@/lib/sponsorblock-prefs";
import { trpc } from "@/trpc/react";

export function SponsorBlockSync() {
  const { data } = trpc.settings.get.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) return;
    writeSponsorBlockPrefs(sponsorBlockPrefsFromAppSettings(data));
  }, [data]);

  return null;
}
