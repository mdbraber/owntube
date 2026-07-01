import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  looksLikeYoutubeChannelId,
  normalizeYoutubeChannelId,
} from "@/lib/youtube-channel-id";
import type { AppDb } from "@/server/db/client";
import { subscriptions, watchHistory } from "@/server/db/schema";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { protectedProcedure, router } from "@/server/trpc/init";

const takeoutInputSchema = z.object({
  payloadJson: z.string().min(2),
  replaceExisting: z.boolean().default(false),
});
const takeoutSubscriptionsInputSchema = z.object({
  payloadCsv: z.string().min(2),
  replaceExisting: z.boolean().default(false),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const DEFAULT_IMPORTED_FULL_WATCH_SECONDS = 15 * 60;

function inferImportedFullWatchSeconds(db: AppDb, userId: number): number {
  const avgDuration = db
    .select({
      avg: sql<number>`cast(avg(${watchHistory.durationWatched}) as integer)`,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.isDeleted, 0),
        gt(watchHistory.durationWatched, 0),
      ),
    )
    .all()[0]?.avg;

  if (!avgDuration || !Number.isFinite(avgDuration)) {
    return DEFAULT_IMPORTED_FULL_WATCH_SECONDS;
  }
  return Math.max(60, Math.min(3 * 3600, Math.floor(avgDuration)));
}

function parseVideoId(url: string): string | null {
  const direct = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (direct?.[1]) return direct[1];
  const shorts = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shorts?.[1]) return shorts[1];
  const ytu = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (ytu?.[1]) return ytu[1];
  return null;
}

function parseChannelId(subtitles: unknown): string | null {
  if (!Array.isArray(subtitles)) return null;
  const first = subtitles[0];
  if (!first || typeof first !== "object") return null;
  const u = (first as { url?: unknown }).url;
  if (typeof u !== "string") return null;
  const m = u.match(/\/channel\/([^/?#]+)/);
  return m?.[1] ?? null;
}

function stripHtml(text: string): string {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTakeoutDate(raw: string): number | null {
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return Math.floor(direct / 1000);

  const normalized = raw
    .toLowerCase()
    .replaceAll(",", " ")
    .replaceAll(".", " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = normalized.match(
    /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return null;

  const monthMap: Record<string, number> = {
    jan: 0,
    janv: 0,
    january: 0,
    fev: 1,
    fevr: 1,
    fevrier: 1,
    feb: 1,
    february: 1,
    mar: 2,
    mars: 2,
    march: 2,
    avr: 3,
    avril: 3,
    apr: 3,
    april: 3,
    mai: 4,
    may: 4,
    jun: 5,
    juin: 5,
    june: 5,
    jul: 6,
    juil: 6,
    juillet: 6,
    july: 6,
    aou: 7,
    aout: 7,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    septembre: 8,
    september: 8,
    oct: 9,
    octobre: 9,
    october: 9,
    nov: 10,
    novembre: 10,
    november: 10,
    dec: 11,
    decembre: 11,
    december: 11,
  };

  const day = Number.parseInt(m[1], 10);
  const monthToken = m[2].normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const year = Number.parseInt(m[3], 10);
  const hour = Number.parseInt(m[4], 10);
  const minute = Number.parseInt(m[5], 10);
  const second = Number.parseInt(m[6] ?? "0", 10);
  const month = monthMap[monthToken];
  if (month == null) return null;
  return Math.floor(Date.UTC(year, month, day, hour, minute, second) / 1000);
}

function parseRowsFromTakeoutHtml(payload: string): Array<{
  videoId: string;
  channelId: string;
  startedAt: number;
}> {
  const rows: Array<{ videoId: string; channelId: string; startedAt: number }> =
    [];
  const blockRe =
    /<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/g;
  for (const match of payload.matchAll(blockRe)) {
    const block = match[1] ?? "";
    const links = Array.from(
      block.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g),
    );
    if (links.length < 2) continue;

    const watchUrl = links[0]?.[1] ?? "";
    const channelUrl = links[1]?.[1] ?? "";
    const videoId = parseVideoId(watchUrl);
    if (!videoId) continue;
    const channelId =
      channelUrl.match(/\/channel\/([^/?#]+)/)?.[1] ?? "unknown";

    const trailing = block.slice(
      (links[1]?.index ?? 0) + (links[1]?.[0]?.length ?? 0),
    );
    const dateText = stripHtml(trailing);
    const startedAt = parseTakeoutDate(dateText) ?? nowUnix();
    rows.push({ videoId, channelId, startedAt });
  }
  return rows;
}

function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === undefined) continue;
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseSubscriptionChannelIds(csv: string): string[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const ids: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (
      i === 0 &&
      (/id des cha|channel id|channel_id|nom de la cha/i.test(line) ||
        (/channel url/i.test(line) && /title/i.test(line)))
    ) {
      continue;
    }

    const urlMatch = line.match(
      /youtube\.com\/channel\/([A-Za-z0-9_-]{10,64})/i,
    );
    if (urlMatch?.[1]) {
      const canon = normalizeYoutubeChannelId(urlMatch[1]);
      if (looksLikeYoutubeChannelId(canon)) ids.push(canon);
      continue;
    }

    const cells = splitCsvRow(line);
    let picked: string | null = null;
    for (const cell of cells) {
      const t = cell.replace(/^"+|"+$/g, "").trim();
      if (!t) continue;
      const canon = normalizeYoutubeChannelId(t);
      if (looksLikeYoutubeChannelId(canon)) {
        picked = canon;
        break;
      }
    }
    if (picked) {
      ids.push(picked);
      continue;
    }

    const first = cells[0]?.replace(/^"+|"+$/g, "").trim() ?? "";
    if (first) {
      const canon = normalizeYoutubeChannelId(first);
      if (looksLikeYoutubeChannelId(canon)) ids.push(canon);
    }
  }
  return Array.from(new Set(ids));
}

export const takeoutRouter = router({
  importHistory: protectedProcedure
    .input(takeoutInputSchema)
    .mutation(({ ctx, input }) => {
      const importedFullWatchSeconds = inferImportedFullWatchSeconds(
        ctx.db,
        ctx.userId,
      );
      const rows: Array<{
        userId: number;
        videoId: string;
        channelId: string;
        startedAt: number;
        durationWatched: number;
        completed: number;
        isDeleted: number;
        createdAt: number;
      }> = [];

      const raw = input.payloadJson.trim();
      const looksLikeHtml =
        raw.startsWith("<!DOCTYPE html") ||
        raw.startsWith("<html") ||
        raw.includes('<div class="content-cell');

      if (looksLikeHtml) {
        const htmlRows = parseRowsFromTakeoutHtml(raw);
        for (const item of htmlRows) {
          rows.push({
            userId: ctx.userId,
            videoId: item.videoId,
            channelId: item.channelId,
            startedAt: item.startedAt,
            durationWatched: importedFullWatchSeconds,
            completed: 1,
            isDeleted: 0,
            createdAt: item.startedAt,
          });
        }
      } else {
        const parsed = JSON.parse(input.payloadJson) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error(
            "Expected Takeout watch-history JSON array or watch-history.html file.",
          );
        }

        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const o = item as {
            titleUrl?: unknown;
            subtitles?: unknown;
            time?: unknown;
          };
          const titleUrl = typeof o.titleUrl === "string" ? o.titleUrl : "";
          const videoId = parseVideoId(titleUrl);
          if (!videoId) continue;

          const dt =
            typeof o.time === "string" ? Date.parse(o.time) : Number.NaN;
          const startedAt = Number.isFinite(dt)
            ? Math.floor(dt / 1000)
            : nowUnix();
          const channelId = parseChannelId(o.subtitles) ?? "unknown";
          rows.push({
            userId: ctx.userId,
            videoId,
            channelId,
            startedAt,
            durationWatched: importedFullWatchSeconds,
            completed: 1,
            isDeleted: 0,
            createdAt: startedAt,
          });
        }
      }

      ctx.db.transaction((tx) => {
        if (input.replaceExisting) {
          tx.delete(watchHistory)
            .where(eq(watchHistory.userId, ctx.userId))
            .run();
        }
        for (const r of rows) {
          tx.insert(watchHistory).values(r).run();
        }
      });
      clearRecommendationCachesForUser(ctx.userId);

      return { imported: rows.length };
    }),
  importSubscriptions: protectedProcedure
    .input(takeoutSubscriptionsInputSchema)
    .mutation(({ ctx, input }) => {
      const channelIds = parseSubscriptionChannelIds(input.payloadCsv);
      const subscribedAt = nowUnix();
      ctx.db.transaction((tx) => {
        if (input.replaceExisting) {
          tx.delete(subscriptions)
            .where(eq(subscriptions.userId, ctx.userId))
            .run();
        }
        for (const channelId of channelIds) {
          tx.insert(subscriptions)
            .values({
              userId: ctx.userId,
              channelId,
              subscribedAt,
            })
            .onConflictDoNothing({
              target: [subscriptions.userId, subscriptions.channelId],
            })
            .run();
        }
      });
      clearRecommendationCachesForUser(ctx.userId);
      return { imported: channelIds.length };
    }),
});
