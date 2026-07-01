import { HomeFeedClient } from "@/components/home/home-feed-client";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import {
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";

export default async function HomePage() {
  const session = await auth();
  const rawUserId = session?.user?.id;
  const userId =
    typeof rawUserId === "string" ? Number.parseInt(rawUserId, 10) : Number.NaN;
  const isAuthed = Number.isFinite(userId) && userId > 0;
  const region = isAuthed
    ? normalizeTrendingRegionStored(
        getUserSettings(getDb(), userId).trendingRegion,
      )
    : "US";

  return (
    <main className="ot-page">
      <HomeFeedClient region={region} isAuthed={isAuthed} />
    </main>
  );
}
