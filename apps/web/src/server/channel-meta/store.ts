import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { channelMeta } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  fetchChannelPage,
  type ProxySourceOverrides,
} from "@/server/services/proxy";

export const CHANNEL_META_TTL_SEC = 7 * 24 * 60 * 60;

const LIST_DETAILED_RETRIES = 4;

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function isFreshChannelMeta(
  updatedAt: number,
  now = nowUnix(),
): boolean {
  return now - updatedAt < CHANNEL_META_TTL_SEC;
}

function isMissingChannelMetaTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.toLowerCase().includes("no such table: channel_meta");
}

export type ChannelMetaRow = {
  channelName: string;
  avatarUrl: string | null;
  description: string | null;
  updatedAt: number;
};

export function readChannelMetaRow(
  db: AppDb,
  channelId: string,
): ChannelMetaRow | null {
  let row:
    | {
        channelName: string;
        avatarUrl: string | null;
        description: string | null;
        updatedAt: number;
      }
    | undefined;
  try {
    row = db
      .select({
        channelName: channelMeta.channelName,
        avatarUrl: channelMeta.avatarUrl,
        description: channelMeta.description,
        updatedAt: channelMeta.updatedAt,
      })
      .from(channelMeta)
      .where(eq(channelMeta.channelId, channelId))
      .limit(1)
      .all()[0];
  } catch (error) {
    if (isMissingChannelMetaTableError(error)) return null;
    throw error;
  }
  if (!row?.channelName) return null;
  return {
    channelName: row.channelName,
    avatarUrl: row.avatarUrl ?? null,
    description: row.description ?? null,
    updatedAt: row.updatedAt,
  };
}

export function upsertChannelMetaRow(
  db: AppDb,
  input: {
    channelId: string;
    channelName: string;
    avatarUrl: string | null;
    description?: string | null;
    /** Omit (undefined) to preserve an existing count; pass a number to set it. */
    subscriberCount?: number | null;
  },
): void {
  const channelName = input.channelName.trim();
  if (!channelName) return;
  // Only touch subscriber_count when a value was provided, so a refresh that
  // lacks it (e.g. upstream omitted it) doesn't wipe a good stored count.
  const subCount =
    typeof input.subscriberCount === "number" &&
    Number.isFinite(input.subscriberCount)
      ? Math.round(input.subscriberCount)
      : undefined;
  try {
    db.insert(channelMeta)
      .values({
        channelId: input.channelId,
        channelName,
        avatarUrl: input.avatarUrl,
        description: input.description ?? null,
        subscriberCount: subCount ?? null,
        updatedAt: nowUnix(),
      })
      .onConflictDoUpdate({
        target: channelMeta.channelId,
        set: {
          channelName,
          avatarUrl: input.avatarUrl,
          description: input.description ?? null,
          updatedAt: nowUnix(),
          ...(subCount !== undefined ? { subscriberCount: subCount } : {}),
        },
      })
      .run();
  } catch (error) {
    if (isMissingChannelMetaTableError(error)) return;
    throw error;
  }
}

export type ChannelMetaLite = {
  channelName: string;
  avatarUrl: string | null;
  description: string | null;
  latestVideoAt: number | null;
  subscriberCount: number | null;
};

export function readChannelMetaByIds(
  db: AppDb,
  channelIds: string[],
): Map<string, ChannelMetaLite> {
  const out = new Map<string, ChannelMetaLite>();
  if (channelIds.length === 0) return out;
  let rows: {
    channelId: string;
    channelName: string;
    avatarUrl: string | null;
    description: string | null;
    latestVideoAt: number | null;
    subscriberCount: number | null;
  }[] = [];
  try {
    rows = db
      .select({
        channelId: channelMeta.channelId,
        channelName: channelMeta.channelName,
        avatarUrl: channelMeta.avatarUrl,
        description: channelMeta.description,
        latestVideoAt: channelMeta.latestVideoAt,
        subscriberCount: channelMeta.subscriberCount,
      })
      .from(channelMeta)
      .where(inArray(channelMeta.channelId, channelIds))
      .all();
  } catch (error) {
    if (isMissingChannelMetaTableError(error)) return out;
    throw error;
  }
  for (const r of rows) {
    const name = r.channelName?.trim();
    if (!name) continue;
    out.set(r.channelId, {
      channelName: name,
      avatarUrl: r.avatarUrl ?? null,
      description: r.description ?? null,
      latestVideoAt: r.latestVideoAt ?? null,
      subscriberCount: r.subscriberCount ?? null,
    });
  }
  return out;
}

/**
 * Set a channel's newest long-form upload timestamp (authoritative overwrite —
 * derived from the long-form uploads playlist, so it excludes Shorts). No-op for
 * channels without a meta row yet; the row appears once name/avatar is known.
 */
export function setChannelLatestVideoAt(
  db: AppDb,
  channelId: string,
  publishedAt: number,
): void {
  if (!Number.isFinite(publishedAt) || publishedAt <= 0) return;
  try {
    db.update(channelMeta)
      .set({ latestVideoAt: Math.floor(publishedAt) })
      .where(eq(channelMeta.channelId, channelId))
      .run();
  } catch (error) {
    if (isMissingChannelMetaTableError(error)) return;
    throw error;
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RefreshedChannelMeta = {
  channelId: string;
  channelName: string;
  avatarUrl: string | null;
  refreshed: boolean;
};

/** Fetches upstream when `channel_meta` is stale or missing, then upserts. */
export async function refreshChannelMetaIfStale(
  db: AppDb,
  channelId: string,
  overrides?: ProxySourceOverrides,
): Promise<RefreshedChannelMeta> {
  const cachedMeta = readChannelMetaRow(db, channelId);
  if (cachedMeta && isFreshChannelMeta(cachedMeta.updatedAt)) {
    return {
      channelId,
      channelName: cachedMeta.channelName,
      avatarUrl: cachedMeta.avatarUrl,
      refreshed: false,
    };
  }

  const fallback: RefreshedChannelMeta = {
    channelId,
    channelName: cachedMeta?.channelName ?? channelId,
    avatarUrl: cachedMeta?.avatarUrl ?? null,
    refreshed: false,
  };

  for (let attempt = 0; attempt < LIST_DETAILED_RETRIES; attempt++) {
    try {
      const page = await fetchChannelPage(db, { channelId }, overrides);
      const resolvedName =
        page.name?.trim() || cachedMeta?.channelName || channelId;
      const resolvedAvatar = page.avatarUrl ?? cachedMeta?.avatarUrl ?? null;
      const resolvedDescription =
        page.description?.trim() || cachedMeta?.description || null;
      upsertChannelMetaRow(db, {
        channelId,
        channelName: resolvedName,
        avatarUrl: resolvedAvatar,
        description: resolvedDescription,
        subscriberCount: page.subscriberCount,
      });
      return {
        channelId,
        channelName: resolvedName,
        avatarUrl: resolvedAvatar,
        refreshed: true,
      };
    } catch (e) {
      if (
        e instanceof RateLimitExceededError &&
        attempt < LIST_DETAILED_RETRIES - 1
      ) {
        await sleepMs(350 * 2 ** attempt);
        continue;
      }
      if (
        e instanceof UpstreamUnavailableError ||
        e instanceof RateLimitExceededError
      ) {
        return fallback;
      }
      throw e;
    }
  }
  return fallback;
}
