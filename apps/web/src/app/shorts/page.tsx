import { ShortsFeedClient } from "@/components/shorts/shorts-feed-client";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { buildShortsExclusionSet } from "@/server/recommendation/shorts-feed";
import { describeUpstreamAvailability } from "@/server/services/proxy";
import { peekFreshVideoDetail } from "@/server/services/proxy/video";
import type { VideoDetail } from "@/server/services/proxy.types";
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

  const viewerId = Number.isFinite(userId) && userId > 0 ? userId : null;
  const exclusionSet =
    viewerId != null ? buildShortsExclusionSet(db, viewerId) : null;
  const initialWatchedVideoIds = exclusionSet ? [...exclusionSet] : [];

  // The feed is resolved on the CLIENT, not here: fetching it during SSR blocks
  // the whole page for the upstream resolve (~11s cold, since a Next RSC render
  // won't release the response until the fetch settles — a timeout race doesn't
  // help). Rendering the shell immediately lets the app appear at once with an
  // in-app spinner while `ShortsFeedClient` pulls the feed; a warm feed still
  // arrives in a couple hundred ms from the server cache.
  //
  // We can still seed the first short's *detail* from cache (synchronous, no
  // upstream) for a deep-linked ?v= short, so it plays the instant it mounts.
  let initialDetail: VideoDetail | null = null;
  if (initialVideoId) {
    try {
      initialDetail = peekFreshVideoDetail(db, { videoId: initialVideoId });
    } catch {
      initialDetail = null;
    }
  }

  return (
    <div className="absolute inset-0">
      <ShortsFeedClient
        region={region}
        initialVideoId={initialVideoId}
        initialFeed={null}
        initialDetail={initialDetail}
        initialUpstream={initialUpstream}
        initialWatchedVideoIds={initialWatchedVideoIds}
        signedIn={viewerId != null}
      />
    </div>
  );
}
