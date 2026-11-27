import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { MEMO_TEXT_MAX_LEN } from "@/lib/memos";
import type { AppDb } from "@/server/db/client";
import { videoMemos } from "@/server/db/schema";

export const MEMO_SOURCE_KINDS = ["direct", "slack", "link"] as const;
export type MemoSourceKind = (typeof MEMO_SOURCE_KINDS)[number];

export const memoVideoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/, "Not a YouTube video id.");

export const memoTextSchema = z.string().trim().min(1).max(MEMO_TEXT_MAX_LEN);

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Only http(s) links.");

const shortTextSchema = z.string().trim().min(1).max(200);

/** Where a memo came from. Omitted on add means `direct`. */
export const memoSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct") }),
  z.object({
    kind: z.literal("slack"),
    /** The Slack message permalink. */
    url: httpUrlSchema,
    /** The channel, e.g. `#design`. */
    label: shortTextSchema.optional(),
    /** Display name of who posted it. */
    author: shortTextSchema.optional(),
    workspace: shortTextSchema.optional(),
  }),
  z.object({
    kind: z.literal("link"),
    url: httpUrlSchema,
    label: shortTextSchema.optional(),
    author: shortTextSchema.optional(),
  }),
]);

export type MemoSourceInput = z.infer<typeof memoSourceSchema>;

/**
 * When the memo was said: a Date (superjson clients), an ISO 8601 string, or
 * Unix seconds as a number or numeric string (a Slack `ts` like
 * "1732714320.000200"), whichever an automation finds easiest to send.
 */
export const memoOccurredAtSchema = z
  .union([
    z.date(),
    z.number().positive(),
    z.string().regex(/^\d{9,11}(\.\d+)?$/),
    z.iso.datetime({ offset: true }),
  ])
  .transform((v) => {
    if (v instanceof Date) return Math.floor(v.getTime() / 1000);
    if (typeof v === "number") return Math.floor(v);
    if (/^\d/.test(v) && !v.includes("-")) return Math.floor(Number(v));
    return Math.floor(new Date(v).getTime() / 1000);
  })
  .refine((s) => Number.isFinite(s) && s > 0, "Not a valid time.");

export type VideoMemo = {
  id: number;
  videoId: string;
  channelId: string | null;
  text: string;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  source: {
    kind: MemoSourceKind;
    url: string | null;
    label: string | null;
    author: string | null;
    workspace: string | null;
  };
};

type MemoRow = typeof videoMemos.$inferSelect;

function sourceKindOf(raw: string): MemoSourceKind {
  return (MEMO_SOURCE_KINDS as readonly string[]).includes(raw)
    ? (raw as MemoSourceKind)
    : "direct";
}

export function toVideoMemo(row: MemoRow): VideoMemo {
  return {
    id: row.id,
    videoId: row.videoId,
    channelId: row.channelId,
    text: row.text,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: {
      kind: sourceKindOf(row.sourceKind),
      url: row.sourceUrl,
      label: row.sourceLabel,
      author: row.sourceAuthor,
      workspace: row.sourceWorkspace,
    },
  };
}

export function ownedMemo(
  db: AppDb,
  userId: number,
  id: number,
): MemoRow | undefined {
  return db
    .select()
    .from(videoMemos)
    .where(and(eq(videoMemos.id, id), eq(videoMemos.userId, userId)))
    .limit(1)
    .all()[0];
}

export function memoBySourceUrl(
  db: AppDb,
  userId: number,
  sourceUrl: string,
): MemoRow | undefined {
  return db
    .select()
    .from(videoMemos)
    .where(
      and(eq(videoMemos.userId, userId), eq(videoMemos.sourceUrl, sourceUrl)),
    )
    .limit(1)
    .all()[0];
}

export function listMemos(
  db: AppDb,
  userId: number,
  videoId: string,
): VideoMemo[] {
  return db
    .select()
    .from(videoMemos)
    .where(and(eq(videoMemos.userId, userId), eq(videoMemos.videoId, videoId)))
    .orderBy(asc(videoMemos.occurredAt), asc(videoMemos.id))
    .all()
    .map(toVideoMemo);
}

export type MemoCount = { videoId: string; count: number; latestText: string };

/**
 * Memo count and the latest memo's text for each of the given videos that has
 * any, in one query (a window function picks the latest per video).
 */
export function memoCounts(
  db: AppDb,
  userId: number,
  videoIds: readonly string[],
): MemoCount[] {
  const ids = [...new Set(videoIds)];
  if (ids.length === 0) return [];
  const ranked = db
    .select({
      videoId: videoMemos.videoId,
      text: videoMemos.text,
      count: sql<number>`count(*) over (partition by ${videoMemos.videoId})`.as(
        "memo_count",
      ),
      rank: sql<number>`row_number() over (partition by ${videoMemos.videoId} order by ${videoMemos.occurredAt} desc, ${videoMemos.id} desc)`.as(
        "memo_rank",
      ),
    })
    .from(videoMemos)
    .where(and(eq(videoMemos.userId, userId), inArray(videoMemos.videoId, ids)))
    .as("ranked");
  return db
    .select({
      videoId: ranked.videoId,
      count: ranked.count,
      latestText: ranked.text,
    })
    .from(ranked)
    .where(eq(ranked.rank, 1))
    .all()
    .map((r) => ({ ...r, count: Number(r.count) }));
}

export type NewMemo = {
  videoId: string;
  channelId?: string | null;
  text: string;
  occurredAt: number;
  source: MemoSourceInput;
  videoTitle?: string | null;
  channelName?: string | null;
};

/**
 * Store a memo, or return the one already stored for the same source URL
 * (unchanged), so an automation can retry safely. `created` says which.
 */
export function insertMemo(
  db: AppDb,
  userId: number,
  memo: NewMemo,
  now: number,
): { memo: VideoMemo; created: boolean } {
  const source = memo.source;
  const sourceUrl = source.kind === "direct" ? null : source.url;
  if (sourceUrl) {
    const existing = memoBySourceUrl(db, userId, sourceUrl);
    if (existing) return { memo: toVideoMemo(existing), created: false };
  }
  const inserted = db
    .insert(videoMemos)
    .values({
      userId,
      videoId: memo.videoId,
      channelId: memo.channelId ?? null,
      text: memo.text,
      occurredAt: memo.occurredAt,
      createdAt: now,
      updatedAt: now,
      sourceKind: source.kind,
      sourceUrl,
      sourceLabel: source.kind === "direct" ? null : (source.label ?? null),
      sourceAuthor: source.kind === "direct" ? null : (source.author ?? null),
      sourceWorkspace:
        source.kind === "slack" ? (source.workspace ?? null) : null,
      videoTitle: memo.videoTitle ?? null,
      channelName: memo.channelName ?? null,
    })
    // A concurrent retry may win the unique (user, source_url) index.
    .onConflictDoNothing()
    .returning()
    .get();
  if (inserted) return { memo: toVideoMemo(inserted), created: true };
  const raced = sourceUrl ? memoBySourceUrl(db, userId, sourceUrl) : undefined;
  if (!raced) throw new Error("memo insert failed");
  return { memo: toVideoMemo(raced), created: false };
}
