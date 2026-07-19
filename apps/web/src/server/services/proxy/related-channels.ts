import { z } from "zod";
import {
  readChannelMetaByIds,
  refreshChannelMetaIfStale,
} from "@/server/channel-meta/store";
import type { AppDb } from "@/server/db/client";
import { readFreshCacheRow, writeCache } from "@/server/services/proxy/cache";
import { fetchChannelPage } from "@/server/services/proxy/channel";
import type { ProxySourceOverrides } from "@/server/services/proxy/config";
import { fetchRelatedVideos } from "@/server/services/proxy/video";

const UCID_RE = /^UC[0-9A-Za-z_-]{22}$/;
/** How many of the channel's recent uploads to seed relatedness from. */
const SEED_VIDEOS = 8;
/** Related videos to pull per seed. */
const RELATED_PER_SEED = 20;
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
 * "Similar channels" for a channel page. YouTube deprecated its featured/
 * related-channels field (Invidious returns it empty), so we derive suggestions
 * from YouTube's recommendation graph instead: take this channel's recent
 * uploads, pull each one's recommended videos, and rank the *other* channels
 * that show up, by how often they co-occur. Result is cached per channel.
 */
export async function fetchRelatedChannels(
  db: AppDb,
  channelId: string,
  overrides?: ProxySourceOverrides,
): Promise<RelatedChannelsResult> {
  // fetchChannelPage normalizes the token and resolves the handle → UC id, and
  // gives us the recent uploads to seed from in one call.
  const page = await fetchChannelPage(db, { channelId }, overrides);
  const canonical = page.channelId;

  const key = `related-channels:v1:${canonical}`;
  const fresh = readFreshCacheRow(db, key);
  if (fresh) {
    const parsed = relatedChannelsResultSchema.safeParse(
      JSON.parse(fresh.payloadJson),
    );
    if (parsed.success) return parsed.data;
  }

  const seedIds = page.videos
    .map((v) => v.videoId)
    .filter((id): id is string => Boolean(id))
    .slice(0, SEED_VIDEOS);

  const related = await Promise.all(
    seedIds.map(async (videoId) => {
      try {
        return await fetchRelatedVideos(
          db,
          { videoId },
          RELATED_PER_SEED,
          overrides,
        );
      } catch {
        return null;
      }
    }),
  );

  const tally = new Map<string, { channel: SuggestedChannel; count: number }>();
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
    ids.map((id) =>
      refreshChannelMetaIfStale(db, id, overrides).catch(() => null),
    ),
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

  const result: RelatedChannelsResult = { channels };
  // Only cache a non-empty result so a transient upstream blip doesn't pin an
  // empty "Similar" tab for the cache TTL.
  if (channels.length > 0) {
    writeCache(db, key, "invidious", result, "channel");
  }
  return result;
}
