import { ShortsFeedClient } from "@/components/shorts/shorts-feed-client";
import { auth } from "@/server/auth";
import { fetchVideoDetail } from "@/server/catalog";
import type { VideoDetail } from "@/server/catalog/types";
import { getDb } from "@/server/db/client";
import {
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

  const viewerId = Number.isFinite(userId) && userId > 0 ? userId : null;

  // The feed is resolved on the CLIENT, not here: fetching it during SSR blocks
  // the whole page for the upstream resolve (~11s cold, since a Next RSC render
  // won't release the response until the fetch settles — a timeout race doesn't
  // help). Rendering the shell immediately lets the app appear at once with an
  // in-app spinner while `ShortsFeedClient` pulls the feed; a warm feed still
  // arrives in a couple hundred ms from the server cache.
  //
  // We can still seed a deep-linked ?v= short's *detail* from the gateway's
  // cache (cache-only: never waits on YouTube), so it plays the instant it
  // mounts.
  const initialDetail: VideoDetail | null = initialVideoId
    ? await fetchVideoDetail(
        { videoId: initialVideoId },
        { cache: "only" },
      ).catch(() => null)
    : null;

  return (
    <div className="absolute inset-0">
      <ShortsFeedClient
        region={region}
        initialVideoId={initialVideoId}
        initialFeed={null}
        initialDetail={initialDetail}
        signedIn={viewerId != null}
      />
    </div>
  );
}
