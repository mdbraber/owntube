import { eq } from "drizzle-orm";
import { z } from "zod";
import { defaultPlaybackQualitySchema } from "@/lib/default-playback-quality";
import {
  DEFAULT_SPONSORBLOCK_CATEGORIES,
  normalizeSponsorBlockCategories,
  sponsorBlockCategorySchema,
} from "@/lib/sponsorblock";
import type { AppDb } from "@/server/db/client";
import { userProfile } from "@/server/db/schema";
import type { ProxySourceOverrides } from "@/server/services/proxy";

export const themeSchema = z.enum(["system", "light", "dark"]);

const tasteKeywordSchema = z.string().trim().min(1).max(80);

export const appSettingsSchema = z.object({
  theme: themeSchema.default("system"),
  pipedBaseUrl: z.string().max(512).optional(),
  invidiousBaseUrl: z.string().max(512).optional(),
  /** ISO 3166-1 alpha-2 trending region (Piped / Invidious). */
  trendingRegion: z.string().length(2).default("US"),
  /** Topics / phrases used to bias the recommendation title similarity corpus. */
  tasteKeywords: z.array(tasteKeywordSchema).max(24).default([]),
  /** Unix seconds when the user finished the taste onboarding flow. */
  tasteOnboardingCompletedAt: z.number().int().optional(),
  /** Unix seconds when the user skipped the taste onboarding flow. */
  tasteOnboardingSkippedAt: z.number().int().optional(),
  /** Hide members/subscribers-only videos when detected in list titles. */
  hideRestrictedVideos: z.boolean().default(true),
  /** Start watch page with cinema mode enabled. */
  defaultCinemaMode: z.boolean().default(false),
  /** Keep a mini player when leaving watch page. */
  enableMiniPlayer: z.boolean().default(true),
  /** Default watch-page quality rung (1080p, 720p, muxed 360p, …). */
  defaultPlaybackQuality: defaultPlaybackQualitySchema.default("1080p"),
  /** Channels excluded from personalized recommendations. */
  blockedRecommendationChannels: z
    .array(z.string().min(1).max(128))
    .max(200)
    .default([]),
  /** Show SponsorBlock segment markers on the watch player timeline. */
  sponsorBlockEnabled: z.boolean().default(true),
  /** Automatically skip SponsorBlock segments during playback. */
  sponsorBlockAutoSkip: z.boolean().default(true),
  /** SponsorBlock segment categories to fetch and apply. */
  sponsorBlockCategories: z
    .array(sponsorBlockCategorySchema)
    .default(DEFAULT_SPONSORBLOCK_CATEGORIES),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export function normalizeTrendingRegionStored(
  input: string | undefined,
  fallback = "US",
): string {
  if (!input || typeof input !== "string") return fallback;
  const t = input.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : fallback;
}

const defaultSettings: AppSettings = {
  theme: "system",
  trendingRegion: "US",
  tasteKeywords: [],
  hideRestrictedVideos: true,
  defaultCinemaMode: false,
  enableMiniPlayer: true,
  defaultPlaybackQuality: "1080p",
  blockedRecommendationChannels: [],
  sponsorBlockEnabled: true,
  sponsorBlockAutoSkip: true,
  sponsorBlockCategories: DEFAULT_SPONSORBLOCK_CATEGORIES,
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeUrlLike(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim();
  return value.length > 0 ? value.replace(/\/+$/, "") : undefined;
}

function normalizeBlockedRecommendationChannels(
  input: string[] | undefined,
): string[] | undefined {
  if (!input) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) break;
  }
  return out;
}

function normalizeTasteKeywords(
  input: string[] | undefined,
): string[] | undefined {
  if (!input) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.trim().slice(0, 80);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 24) break;
  }
  return out;
}

export function getUserSettings(db: AppDb, userId: number): AppSettings {
  const row = db
    .select({ profileJson: userProfile.profileJson })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1)
    .all()[0];
  if (!row) return defaultSettings;
  try {
    const parsed = appSettingsSchema.safeParse(JSON.parse(row.profileJson));
    return parsed.success ? parsed.data : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export function upsertUserSettings(
  db: AppDb,
  userId: number,
  patch: Partial<AppSettings>,
): AppSettings {
  const previous = getUserSettings(db, userId);
  const nextKeywords =
    patch.tasteKeywords !== undefined
      ? (normalizeTasteKeywords(patch.tasteKeywords) ?? [])
      : previous.tasteKeywords;
  const nextBlockedChannels =
    patch.blockedRecommendationChannels !== undefined
      ? (normalizeBlockedRecommendationChannels(
          patch.blockedRecommendationChannels,
        ) ?? [])
      : previous.blockedRecommendationChannels;
  const nextSponsorBlockCategories =
    patch.sponsorBlockCategories !== undefined
      ? normalizeSponsorBlockCategories(patch.sponsorBlockCategories)
      : previous.sponsorBlockCategories;
  const merged: AppSettings = {
    ...previous,
    ...patch,
    tasteKeywords: nextKeywords,
    blockedRecommendationChannels: nextBlockedChannels,
    sponsorBlockCategories: nextSponsorBlockCategories,
    pipedBaseUrl: normalizeUrlLike(patch.pipedBaseUrl ?? previous.pipedBaseUrl),
    invidiousBaseUrl: normalizeUrlLike(
      patch.invidiousBaseUrl ?? previous.invidiousBaseUrl,
    ),
    trendingRegion: normalizeTrendingRegionStored(
      patch.trendingRegion ?? previous.trendingRegion,
    ),
  };
  const safe = appSettingsSchema.parse(merged);
  const ts = nowUnix();
  db.insert(userProfile)
    .values({
      userId,
      profileJson: JSON.stringify(safe),
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: {
        profileJson: JSON.stringify(safe),
        updatedAt: ts,
      },
    })
    .run();
  return safe;
}

export function getUserProxyOverrides(
  db: AppDb,
  userId: number | null,
): ProxySourceOverrides | undefined {
  if (!userId) return undefined;
  const settings = getUserSettings(db, userId);
  if (!settings.pipedBaseUrl && !settings.invidiousBaseUrl) return undefined;
  return {
    pipedBaseUrl: settings.pipedBaseUrl,
    invidiousBaseUrl: settings.invidiousBaseUrl,
  };
}
