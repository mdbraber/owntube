import { z } from "zod";

/** Skip-type categories supported in v1 (excludes filler by default). */
export const sponsorBlockCategorySchema = z.enum([
  "sponsor",
  "selfpromo",
  "interaction",
  "intro",
  "outro",
  "preview",
  "hook",
  "filler",
]);

export type SponsorBlockCategory = z.infer<typeof sponsorBlockCategorySchema>;

export const SPONSORBLOCK_ALL_CATEGORIES = sponsorBlockCategorySchema.options;

export const DEFAULT_SPONSORBLOCK_CATEGORIES: SponsorBlockCategory[] = [
  "sponsor",
  "selfpromo",
  "interaction",
  "intro",
  "outro",
  "preview",
  "hook",
];

export const SPONSORBLOCK_CATEGORY_LABELS: Record<
  SponsorBlockCategory,
  string
> = {
  sponsor: "Sponsor",
  selfpromo: "Self-promotion",
  interaction: "Interaction reminder",
  intro: "Intro",
  outro: "Outro",
  preview: "Preview / recap",
  hook: "Hook",
  filler: "Filler (aggressive)",
};

export const SPONSORBLOCK_HASH_PREFIX_LENGTH = 4;

export type SponsorBlockSegment = {
  uuid: string;
  category: SponsorBlockCategory;
  startSeconds: number;
  endSeconds: number;
};

export type SponsorBlockApiSegment = {
  segment?: number[];
  UUID?: string;
  category?: string;
  actionType?: string;
};

export type SponsorBlockPrefixVideo = {
  videoID?: string;
  hash?: string;
  segments?: SponsorBlockApiSegment[];
};

export function findPrefixResponseForVideo(
  entries: SponsorBlockPrefixVideo[],
  fullHash: string,
  videoId?: string,
): SponsorBlockPrefixVideo | null {
  for (const entry of entries) {
    if (entry.hash === fullHash) return entry;
    if (videoId && entry.videoID === videoId) return entry;
  }
  return null;
}

function parseCategory(raw: string | undefined): SponsorBlockCategory | null {
  if (!raw) return null;
  const parsed = sponsorBlockCategorySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function normalizeSponsorBlockSegments(
  rawSegments: SponsorBlockApiSegment[],
  options: {
    categories: readonly SponsorBlockCategory[];
    durationSeconds?: number;
  },
): SponsorBlockSegment[] {
  const categorySet = new Set(options.categories);
  const maxEnd =
    typeof options.durationSeconds === "number" &&
    Number.isFinite(options.durationSeconds) &&
    options.durationSeconds > 0
      ? options.durationSeconds
      : null;

  const parsed: SponsorBlockSegment[] = [];
  for (const row of rawSegments) {
    if (row.actionType && row.actionType !== "skip") continue;
    const category = parseCategory(row.category);
    if (!category || !categorySet.has(category)) continue;
    const pair = row.segment;
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const startSeconds = Number(pair[0]);
    const endSeconds = Number(pair[1]);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      endSeconds <= startSeconds
    ) {
      continue;
    }
    const uuid = row.UUID?.trim();
    if (!uuid) continue;
    const clampedEnd =
      maxEnd !== null ? Math.min(endSeconds, maxEnd) : endSeconds;
    const clampedStart = Math.max(0, Math.min(startSeconds, clampedEnd));
    if (clampedEnd <= clampedStart) continue;
    parsed.push({
      uuid,
      category,
      startSeconds: clampedStart,
      endSeconds: clampedEnd,
    });
  }

  parsed.sort((a, b) => a.startSeconds - b.startSeconds);

  const deduped: SponsorBlockSegment[] = [];
  for (const seg of parsed) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.uuid === seg.uuid) continue;
    deduped.push(seg);
  }
  return deduped;
}

export function segmentAtTime(
  segments: readonly SponsorBlockSegment[],
  timeSeconds: number,
): SponsorBlockSegment | null {
  if (!Number.isFinite(timeSeconds)) return null;
  for (const seg of segments) {
    if (timeSeconds >= seg.startSeconds && timeSeconds < seg.endSeconds) {
      return seg;
    }
  }
  return null;
}

export function categoryLabel(category: SponsorBlockCategory): string {
  return SPONSORBLOCK_CATEGORY_LABELS[category];
}

const SKIP_EPSILON_SECONDS = 0.05;

export function seekTargetAfterSegment(segment: SponsorBlockSegment): number {
  return segment.endSeconds + SKIP_EPSILON_SECONDS;
}

export type SponsorBlockSkipDecision = {
  segment: SponsorBlockSegment;
  seekTo: number;
};

export function decideSponsorBlockSkip(input: {
  currentTime: number;
  segments: readonly SponsorBlockSegment[];
  skippedUuids: ReadonlySet<string>;
  isScrubbing: boolean;
  enabled: boolean;
  autoSkip: boolean;
  paused: boolean;
}): SponsorBlockSkipDecision | null {
  if (!input.enabled || !input.autoSkip || input.paused || input.isScrubbing) {
    return null;
  }
  const active = segmentAtTime(input.segments, input.currentTime);
  if (!active || input.skippedUuids.has(active.uuid)) return null;
  return {
    segment: active,
    seekTo: seekTargetAfterSegment(active),
  };
}

export function normalizeSponsorBlockCategories(
  input: string[] | undefined,
): SponsorBlockCategory[] {
  if (!input?.length) return [...DEFAULT_SPONSORBLOCK_CATEGORIES];
  const seen = new Set<SponsorBlockCategory>();
  const out: SponsorBlockCategory[] = [];
  for (const raw of input) {
    const parsed = sponsorBlockCategorySchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    out.push(parsed.data);
  }
  return out.length > 0 ? out : [...DEFAULT_SPONSORBLOCK_CATEGORIES];
}
