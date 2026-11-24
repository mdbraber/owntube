import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { normalizeChannelTag } from "@/lib/channel-tag";
import type { AppDb } from "@/server/db/client";
import { channelTags } from "@/server/db/schema";
import { getUserSettings } from "@/server/settings/profile";

const tagListSchema = z.array(z.string().max(40)).max(64).optional();

/**
 * Which subscribed channels a feed covers, by the user's channel tags.
 * Shared by the merged feed and the channel list of the Favorites / tag pages.
 */
export const tagFeedFilterSchema = z.object({
  includeTags: tagListSchema,
  excludeTags: tagListSchema,
  /** "all": a channel needs every included tag. Default "any". */
  tagMatch: z.enum(["any", "all"]).optional(),
  /** Add the user's favorite tag (settings.favoriteTag) to the include list. */
  favorites: z.boolean().optional(),
});

export type TagFeedFilterInput = z.infer<typeof tagFeedFilterSchema>;

function normalizeTagList(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const out = new Set<string>();
  for (const t of raw) {
    const norm = normalizeChannelTag(t);
    if (norm) out.add(norm);
  }
  return [...out];
}

/**
 * Filter a channel-id list by the user's local tags. A channel is kept when it
 * has none of the excluded tags AND (no include tags are active OR it carries
 * at least one — or, with `tagMatch: "all"`, every one). Untagged channels
 * drop out as soon as any include tag is active.
 */
export function filterChannelIdsByTags(
  db: AppDb,
  userId: number,
  channelIds: string[],
  filter: TagFeedFilterInput,
): string[] {
  const includeSet = new Set(normalizeTagList(filter.includeTags));
  if (filter.favorites) {
    includeSet.add(getUserSettings(db, userId).favoriteTag);
  }
  const include = [...includeSet];
  const exclude = normalizeTagList(filter.excludeTags);
  if (include.length === 0 && exclude.length === 0) return channelIds;
  // Favorites plus other tags only makes sense as a narrowing.
  const matchAll =
    filter.tagMatch === "all" ||
    (filter.favorites === true && include.length > 1);

  const wanted = [...new Set([...include, ...exclude])];
  const rows = db
    .select({ channelId: channelTags.channelId, tag: channelTags.tag })
    .from(channelTags)
    .where(
      and(eq(channelTags.userId, userId), inArray(channelTags.tag, wanted)),
    )
    .all();
  const tagsByChannel = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = tagsByChannel.get(r.channelId);
    if (!set) {
      set = new Set<string>();
      tagsByChannel.set(r.channelId, set);
    }
    set.add(r.tag);
  }

  const excludeSet = new Set(exclude);
  return channelIds.filter((id) => {
    const tags = tagsByChannel.get(id);
    if (excludeSet.size > 0 && tags) {
      for (const t of tags) if (excludeSet.has(t)) return false;
    }
    if (include.length === 0) return true;
    if (!tags) return false;
    return matchAll
      ? include.every((t) => tags.has(t))
      : include.some((t) => tags.has(t));
  });
}
