import { ShortsFeedClient } from "@/components/shorts/shorts-feed-client";
import { prepareShortsFeedVideos } from "@/lib/shorts-feed-presentation";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import {
  buildShortsExclusionSet,
  fetchShortsFeedForViewer,
} from "@/server/recommendation/shorts-feed";
import { describeUpstreamAvailability } from "@/server/services/proxy";
import type { ShortsFeedResult } from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";

type ShortsPageProps = {
  searchParams: Promise<{ v?: string | string[] }>;
};

export default async function ShortsPage({ searchParams }: ShortsPageProps) {
  const sp = await searchParams;
  const rawV = typeof sp.v === "string" ? sp.v.trim() : "";
  const initialVideoId = /^[a-zA-Z0-9_-]{11}$/.test(rawV) ? rawV : undefined;

  const session = await auth();
  const rawUserId = session?.user?.id;
  const userId =
    typeof rawUserId === "string" ? Number.parseInt(rawUserId, 10) : Number.NaN;
  const db = getDb();
  const region =
    Number.isFinite(userId) && userId > 0
      ? normalizeTrendingRegionStored(
          getUserSettings(db, userId).trendingRegion,
        )
      : "US";

  const overrides =
    Number.isFinite(userId) && userId > 0
      ? getUserProxyOverrides(db, userId)
      : undefined;
  const initialUpstream = describeUpstreamAvailability(overrides);

  let initialFeed: ShortsFeedResult | null = null;
  const viewerId = Number.isFinite(userId) && userId > 0 ? userId : null;
  const exclusionSet =
    viewerId != null ? buildShortsExclusionSet(db, viewerId) : null;
  const initialWatchedVideoIds = exclusionSet ? [...exclusionSet] : [];
  try {
    initialFeed = await fetchShortsFeedForViewer(
      db,
      viewerId,
      {
        region,
        limit: 24,
        excludeVideoIds:
          initialWatchedVideoIds.length > 0
            ? initialWatchedVideoIds.slice(-200)
            : undefined,
      },
      overrides,
    );
    if (initialFeed) {
      let videos = prepareShortsFeedVideos(initialFeed.videos, 24);
      if (exclusionSet && exclusionSet.size > 0) {
        videos = videos.filter((v) => !exclusionSet.has(v.videoId));
      }
      initialFeed = { ...initialFeed, videos };
    }
  } catch {
    initialFeed = null;
  }

  return (
    <div className="absolute inset-0">
      <ShortsFeedClient
        region={region}
        initialVideoId={initialVideoId}
        initialFeed={initialFeed}
        initialUpstream={initialUpstream}
        initialWatchedVideoIds={initialWatchedVideoIds}
        signedIn={viewerId != null}
      />
    </div>
  );
}
