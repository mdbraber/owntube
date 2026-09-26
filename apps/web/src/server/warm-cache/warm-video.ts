import type { AppDb } from "@/server/db/client";
import { fetchVideoComments, fetchVideoDetail } from "@/server/services/proxy";
import {
  DEFAULT_SPONSORBLOCK_CATEGORIES,
  getSponsorBlockSegments,
} from "@/server/sponsorblock/service";

export type WarmVideoOptions = {
  /**
   * Also warm SponsorBlock segments. Off for just-uploaded videos: nobody has
   * submitted segments yet, and the empty result would be cached for hours.
   */
  sponsorBlock?: boolean;
};

/**
 * Pull what the watch page reads for one video (detail + streams, top
 * comments, optionally SponsorBlock) into the SQLite caches. Returns false
 * when the detail itself was unavailable (age-restricted, removed, upcoming);
 * comments and segments are best-effort.
 */
export async function warmVideo(
  db: AppDb,
  videoId: string,
  options: WarmVideoOptions = {},
): Promise<boolean> {
  let ok = false;
  try {
    await fetchVideoDetail(db, { videoId });
    ok = true;
  } catch {
    /* age-restricted/unavailable: skip */
  }
  await fetchVideoComments(db, { videoId, sortBy: "top" }).catch(() => {});
  if (options.sponsorBlock ?? true) {
    await getSponsorBlockSegments(db, {
      videoId,
      categories: [...DEFAULT_SPONSORBLOCK_CATEGORIES],
    }).catch(() => {});
  }
  return ok;
}
