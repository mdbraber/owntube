import {
  looksLikeHtmlDescription,
  normalizePipedDescription,
} from "@/lib/normalize-video-description";

export type VideoChapter = {
  startSeconds: number;
  title: string;
};

const CHAPTER_LINE_REGEX =
  /(?:^|\s)(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?:\s*[-–—]\s*|\s+)(.+?)\s*$/;

function normalizeChapterLine(line: string): string {
  return line.replace(/^[-•*▪►]\s+/, "").trim();
}

function parseTimestampToSeconds(match: RegExpMatchArray): number {
  const hourOrMinute = Number.parseInt(match[1] ?? "0", 10);
  const minuteOrSecond = Number.parseInt(match[2] ?? "0", 10);
  const second = Number.parseInt(match[3] ?? "0", 10);
  if (match[3]) {
    return hourOrMinute * 3600 + minuteOrSecond * 60 + second;
  }
  return hourOrMinute * 60 + minuteOrSecond;
}

export function parseChaptersFromDescription(
  description: string | null | undefined,
  durationSeconds?: number,
): VideoChapter[] {
  if (!description) return [];

  const plain = looksLikeHtmlDescription(description)
    ? normalizePipedDescription(description)
    : description;

  const lines = plain
    .split(/\r?\n/)
    .map((line) => normalizeChapterLine(line.trim()))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const parsed = lines
    .map((line) => {
      const match = line.match(CHAPTER_LINE_REGEX);
      if (!match) return null;
      const startSeconds = parseTimestampToSeconds(match);
      const title = (match[4] ?? "").trim();
      if (!title) return null;
      return { startSeconds, title };
    })
    .filter((chapter): chapter is VideoChapter => chapter !== null);

  if (parsed.length < 2) return [];

  const deduped = parsed.filter(
    (chapter, index) =>
      index === 0 || chapter.startSeconds !== parsed[index - 1]?.startSeconds,
  );

  if (deduped[0]?.startSeconds !== 0) return [];

  const strictlyIncreasing = deduped.every(
    (chapter, index) =>
      index === 0 ||
      chapter.startSeconds > (deduped[index - 1]?.startSeconds ?? -1),
  );
  if (!strictlyIncreasing) return [];

  if (
    durationSeconds &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
  ) {
    const withinDuration = deduped.every(
      (chapter) => chapter.startSeconds < durationSeconds,
    );
    if (!withinDuration) return [];
  }

  return deduped;
}

export function chapterIndexAt(
  chapters: VideoChapter[],
  timeSeconds: number,
): number {
  if (chapters.length === 0 || !Number.isFinite(timeSeconds)) return -1;
  if (timeSeconds < (chapters[0]?.startSeconds ?? 0)) return -1;
  for (let i = chapters.length - 1; i >= 0; i--) {
    const start = chapters[i]?.startSeconds ?? 0;
    if (timeSeconds >= start) return i;
  }
  return -1;
}
