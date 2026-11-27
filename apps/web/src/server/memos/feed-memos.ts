import { and, asc, eq, inArray } from "drizzle-orm";
import { memoPlainText, memoSourceLabel } from "@/lib/memos";
import type { AppDb } from "@/server/db/client";
import { videoMemos } from "@/server/db/schema";
import { toVideoMemo, type VideoMemo } from "@/server/memos/memos";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "2026-11-27 13:32 UTC": a feed has no reader time zone to go by. */
function utcTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/**
 * Plain-text block of memos for the top of an episode description: per memo
 * who and when, the text, and the source link when there is one.
 */
export function memoPreamble(memos: readonly VideoMemo[]): string {
  if (memos.length === 0) return "";
  const blocks = memos.map((m) => {
    const head = `${memoSourceLabel(m.source)} · ${utcTime(m.occurredAt)}`;
    const text = memoPlainText(m.text, { urls: true });
    // A text that already links its source doesn't need it again.
    const url =
      m.source.url && !text.includes(m.source.url) ? m.source.url : "";
    return [head, text, url].filter(Boolean).join("\n");
  });
  return `Memos\n\n${blocks.join("\n\n")}`;
}

/** Prefix a description with its memos, separated by a rule. */
export function withMemoPreamble(
  description: string | undefined,
  memos: readonly VideoMemo[],
): string | undefined {
  const preamble = memoPreamble(memos);
  if (!preamble) return description;
  return description ? `${preamble}\n\n———\n\n${description}` : preamble;
}

/** The user's memos on these videos, oldest first, by video (one query). */
export function memosByVideo(
  db: AppDb,
  userId: number,
  videoIds: readonly string[],
): Map<string, VideoMemo[]> {
  const out = new Map<string, VideoMemo[]>();
  const ids = [...new Set(videoIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db
      .select()
      .from(videoMemos)
      .where(
        and(
          eq(videoMemos.userId, userId),
          inArray(videoMemos.videoId, ids.slice(i, i + 500)),
        ),
      )
      .orderBy(asc(videoMemos.occurredAt), asc(videoMemos.id))
      .all();
    for (const row of rows) {
      const list = out.get(row.videoId) ?? [];
      list.push(toVideoMemo(row));
      out.set(row.videoId, list);
    }
  }
  return out;
}
