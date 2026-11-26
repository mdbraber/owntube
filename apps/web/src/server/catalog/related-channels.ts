import { z } from "zod";
import {
  fetchChannelPage,
  fetchFeaturedChannels,
  fetchRelatedVideos,
} from "@/server/catalog";
import {
  readChannelMetaByIds,
  refreshChannelMetaIfStale,
} from "@/server/channel-meta/store";
import type { AppDb } from "@/server/db/client";

const UCID_RE = /^UC[0-9A-Za-z_-]{22}$/;
/** How many of the channel's recent uploads to seed relatedness from. */
const SEED_VIDEOS = 8;
/** Related videos to pull per seed. */
const RELATED_PER_SEED = 20;
/** Ranks featured channels above any co-occurrence count, in their order. */
const FEATURED_RANK = 1_000_000;
/** Suggestions returned. */
const RELATED_LIMIT = 12;

export const suggestedChannelSchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  channelAvatarUrl: z.string().optional(),
  description: z.string().optional(),
  subscriberCount: z.number().optional(),
  latestVideoAt: z.number().optional(),
});
export const relatedChannelsResultSchema = z.object({
  channels: z.array(suggestedChannelSchema),
});
export type SuggestedChannel = z.infer<typeof suggestedChannelSchema>;
export type RelatedChannelsResult = z.infer<typeof relatedChannelsResultSchema>;

/**
 * "Similar channels" for a channel page: the channels it features on its home
 * tab, then the channels YouTube recommends alongside its recent uploads,
 * ranked by how often they co-occur.
 */
export async function fetchRelatedChannels(
  db: AppDb,
  channelId: string,
): Promise<RelatedChannelsResult> {
  const page = await fetchChannelPage({ channelId });
  const canonical = page.channelId;
  const featured = await fetchFeaturedChannels(canonical).catch(() => []);

  const seedIds = page.videos
    .map((v) => v.videoId)
    .filter((id): id is string => Boolean(id))
    .slice(0, SEED_VIDEOS);

  const related = await Promise.all(
    seedIds.map(async (videoId) => {
      try {
        return await fetchRelatedVideos({ videoId }, RELATED_PER_SEED);
      } catch {
        return null;
      }
    }),
  );

  const tally = new Map<string, { channel: SuggestedChannel; count: number }>();
  // Featured channels lead: the channel chose them.
  for (const [i, c] of featured.entries()) {
    if (c.channelId === canonical) continue;
    tally.set(c.channelId, {
      count: FEATURED_RANK - i,
      channel: {
        channelId: c.channelId,
        channelName: c.name,
        channelAvatarUrl: c.avatarUrl,
      },
    });
  }
  for (const res of related) {
    if (!res) continue;
    for (const v of res.videos) {
      const cid = v.channelId;
      if (!cid || cid === canonical || !UCID_RE.test(cid)) continue;
      const entry = tally.get(cid);
      if (entry) {
        entry.count += 1;
        if (!entry.channel.channelAvatarUrl && v.channelAvatarUrl) {
          entry.channel.channelAvatarUrl = v.channelAvatarUrl;
        }
      } else {
        tally.set(cid, {
          count: 1,
          channel: {
            channelId: cid,
            channelName: v.channelName ?? cid,
            channelAvatarUrl: v.channelAvatarUrl,
          },
        });
      }
    }
  }

  const ranked = [...tally.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.channel.channelName.localeCompare(b.channel.channelName),
    )
    .slice(0, RELATED_LIMIT)
    .map((e) => e.channel);

  // Enrich each suggestion with description + subscriber count so the "Similar"
  // tab matches the channels list. channel_meta carries these; refresh any
  // stale/missing rows first (fresh rows are a no-op), then read them back.
  const ids = ranked.map((c) => c.channelId);
  await Promise.all(
    ids.map((id) => refreshChannelMetaIfStale(db, id).catch(() => null)),
  );
  const meta = readChannelMetaByIds(db, ids);
  const channels: SuggestedChannel[] = ranked.map((c) => {
    const m = meta.get(c.channelId);
    const description = m?.description?.split("\n")[0]?.trim() || undefined;
    return {
      channelId: c.channelId,
      channelName: m?.channelName || c.channelName,
      channelAvatarUrl: m?.avatarUrl ?? c.channelAvatarUrl,
      description,
      subscriberCount: m?.subscriberCount ?? undefined,
      latestVideoAt: m?.latestVideoAt ?? undefined,
    };
  });

  return { channels };
}
