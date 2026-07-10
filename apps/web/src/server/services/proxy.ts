import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";

export { fetchVideoComments } from "@/server/services/proxy/comments";
export {
  describeUpstreamAvailability,
  getInstanceSourceInfo,
  type InstanceSourceInfo,
  type InstanceSourceRow,
  type ProxySourceOverrides,
  resolveEffectiveProxyBases,
  resolveProxyBaseCandidates,
  resolveProxyBases,
  type UpstreamAvailability,
} from "@/server/services/proxy/config";
import { clearSearchInFlight } from "@/server/services/proxy/search";

export { searchVideos } from "@/server/services/proxy/search";

import { clearTrendingInFlight } from "@/server/services/proxy/trending";

export { fetchTrendingVideos } from "@/server/services/proxy/trending";

import { clearChannelInFlight } from "@/server/services/proxy/channel";

export {
  type FetchChannelPageOptions,
  fetchChannelPage,
} from "@/server/services/proxy/channel";

import { clearShortsInFlight } from "@/server/services/proxy/shorts";
import { clearRelatedInFlight } from "@/server/services/proxy/video";

export { fetchShortsFeed } from "@/server/services/proxy/shorts";

export function clearProxyCaches(db: AppDb): { clearedRows: number } {
  clearTrendingInFlight();
  clearChannelInFlight();
  clearShortsInFlight();
  clearSearchInFlight();
  clearRelatedInFlight();
  const res = db.delete(videoCache).run();
  return { clearedRows: Number(res.changes ?? 0) };
}

export { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
export { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";

export {
  type FetchVideoDetailOptions,
  fetchRelatedVideos,
  fetchVideoDetail,
} from "@/server/services/proxy/video";
