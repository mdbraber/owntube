import { eq } from "drizzle-orm";
import { z } from "zod";
import { defaultPlaybackQualitySchema } from "@/lib/default-playback-quality";
import { DEFAULT_HOME_BLOCKS, HOME_BLOCK_TYPES } from "@/lib/home-blocks";
import {
  DEFAULT_QUICK_ACTIONS,
  LEGACY_DEFAULT_QUICK_ACTIONS,
  QUICK_ACTION_VALUES,
} from "@/lib/quick-actions";
import {
  DEFAULT_SPONSORBLOCK_CATEGORIES,
  normalizeSponsorBlockCategories,
  sponsorBlockCategorySchema,
} from "@/lib/sponsorblock";
import {
  normalizePreferredUpstreamInstance,
  normalizeUpstreamInstanceList,
} from "@/lib/upstream-instances";
import type { AppDb } from "@/server/db/client";
import { userProfile } from "@/server/db/schema";
import type { ProxySourceOverrides } from "@/server/services/proxy";

export const themeSchema = z.enum(["system", "light", "dark"]);
export const visualThemeSchema = z.enum(["default", "terminal"]);

const tasteKeywordSchema = z.string().trim().min(1).max(80);

const swipeActionSchema = z.enum([
  "none",
  "queue",
  "saved",
  "ignore",
  "watched",
]);

/**
 * One action per swipe direction. Older profiles stored four slots
 * (short/long × left/right); the preprocess step migrates them by keeping the
 * short-swipe mapping, which was the reachable one in practice.
 */
const swipeGesturesSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object" && "shortLeft" in value) {
      const legacy = value as Record<string, unknown>;
      return { left: legacy.shortLeft, right: legacy.shortRight };
    }
    return value;
  },
  z.object({
    left: swipeActionSchema.default("ignore"),
    right: swipeActionSchema.default("queue"),
  }),
);

export const quickActionSchema = z.enum(QUICK_ACTION_VALUES);

/** Per-page prefs shared by the library pages (History / Queue / Saved). */
const DEFAULT_SECTION_PAGE_PREFS = {
  hideCompleted: false,
  rowSize: "md",
} as const;
const sectionPagePrefsSchema = z
  .object({
    hideCompleted: z.boolean().default(false),
    rowSize: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
  })
  .default(DEFAULT_SECTION_PAGE_PREFS);

export const appSettingsSchema = z.object({
  theme: themeSchema.default("system"),
  visualTheme: visualThemeSchema.default("default"),
  pipedBaseUrl: z.string().max(512).optional(),
  invidiousBaseUrl: z.string().max(512).optional(),
  pipedBaseUrls: z.array(z.string().max(512)).max(8).default([]),
  invidiousBaseUrls: z.array(z.string().max(512)).max(8).default([]),
  preferredPipedBaseUrl: z.string().max(512).optional(),
  preferredInvidiousBaseUrl: z.string().max(512).optional(),
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
  /** Hide YouTube Shorts from the subscriptions feed (UULF long-form allowlist + duration/#shorts fallback). */
  hideShortsInSubscriptions: z.boolean().default(true),
  /** Start watch page with cinema mode enabled. */
  defaultCinemaMode: z.boolean().default(false),
  /** Keep a mini player when leaving watch page. */
  enableMiniPlayer: z.boolean().default(true),
  /** Start playing automatically when the watch page opens. */
  autoplayOnWatch: z.boolean().default(true),
  /** Auto-advance to the next queued/related video when one ends. */
  autoplayNext: z.boolean().default(true),
  /** Default watch-page quality rung (1080p, 720p, muxed 360p, …). */
  defaultPlaybackQuality: defaultPlaybackQualitySchema.default("1080p"),
  /** Channels excluded from personalized recommendations. */
  blockedRecommendationChannels: z
    .array(z.string().min(1).max(128))
    .max(200)
    .default([]),
  /**
   * Keep uploads from channels you already subscribe to out of personalized
   * recommendations (they're still in your Subscriptions feed). Opt-in.
   */
  excludeSubscribedFromRecommendations: z.boolean().default(false),
  /** Show SponsorBlock segment markers on the watch player timeline. */
  sponsorBlockEnabled: z.boolean().default(true),
  /** Automatically skip SponsorBlock segments during playback. */
  sponsorBlockAutoSkip: z.boolean().default(true),
  /** SponsorBlock segment categories to fetch and apply. */
  sponsorBlockCategories: z
    .array(sponsorBlockCategorySchema)
    .default(DEFAULT_SPONSORBLOCK_CATEGORIES),
  /** Enable mobile swipe gestures on Home/Explore/Subscriptions cards. */
  enableSwipeGestures: z.boolean().default(true),
  /** Action mapping for a swipe left / right (one action per direction). */
  swipeGestures: swipeGesturesSchema.default({
    left: "ignore",
    right: "queue",
  }),
  /**
   * Ordered quick-action verbs: the first two surface as thumbnail hover
   * buttons on desktop, the first four as the chip row atop the mobile sheet.
   */
  quickActions: z.preprocess(
    (value) =>
      // Profiles that stored the old default verbatim follow the new default.
      Array.isArray(value) &&
      value.join(",") === LEGACY_DEFAULT_QUICK_ACTIONS.join(",")
        ? DEFAULT_QUICK_ACTIONS
        : value,
    z.array(quickActionSchema).max(4).default(DEFAULT_QUICK_ACTIONS),
  ),
  /** Ordered blocks of the modular home page. */
  homeBlocks: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(HOME_BLOCK_TYPES),
        playlistId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(24).default(8),
        rows: z.number().int().min(1).max(8).default(2),
        layout: z.enum(["cards", "rows"]).default("cards"),
        size: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
        /** Section-option values for this block (independent of the page's). */
        options: z.record(z.string(), z.boolean()).optional(),
      }),
    )
    .max(16)
    .default(DEFAULT_HOME_BLOCKS),
  /**
   * Per-section preferences — the single "base" shared by a section's page
   * and its home block (e.g. History's hide-completed filter), so the option
   * stays in sync wherever the section renders.
   */
  sectionPrefs: z
    .object({
      history: sectionPagePrefsSchema,
      queue: sectionPagePrefsSchema,
      saved: sectionPagePrefsSchema,
    })
    .default({
      history: DEFAULT_SECTION_PAGE_PREFS,
      queue: DEFAULT_SECTION_PAGE_PREFS,
      saved: DEFAULT_SECTION_PAGE_PREFS,
    }),
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
  visualTheme: "default",
  pipedBaseUrls: [],
  invidiousBaseUrls: [],
  trendingRegion: "US",
  tasteKeywords: [],
  hideRestrictedVideos: true,
  hideShortsInSubscriptions: true,
  defaultCinemaMode: false,
  enableMiniPlayer: true,
  autoplayOnWatch: true,
  autoplayNext: true,
  defaultPlaybackQuality: "1080p",
  blockedRecommendationChannels: [],
  excludeSubscribedFromRecommendations: false,
  sponsorBlockEnabled: true,
  sponsorBlockAutoSkip: true,
  sponsorBlockCategories: DEFAULT_SPONSORBLOCK_CATEGORIES,
  enableSwipeGestures: true,
  swipeGestures: {
    left: "ignore",
    right: "queue",
  },
  quickActions: DEFAULT_QUICK_ACTIONS,
  homeBlocks: DEFAULT_HOME_BLOCKS,
  sectionPrefs: {
    history: DEFAULT_SECTION_PAGE_PREFS,
    queue: DEFAULT_SECTION_PAGE_PREFS,
    saved: DEFAULT_SECTION_PAGE_PREFS,
  },
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeUrlLike(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim();
  return value.length > 0 ? value.replace(/\/+$/, "") : undefined;
}

function settingsWithNormalizedInstances(settings: AppSettings): AppSettings {
  const pipedBaseUrls = normalizeUpstreamInstanceList([
    ...(settings.pipedBaseUrls ?? []),
    ...(settings.pipedBaseUrl ? [settings.pipedBaseUrl] : []),
  ]);
  const invidiousBaseUrls = normalizeUpstreamInstanceList([
    ...(settings.invidiousBaseUrls ?? []),
    ...(settings.invidiousBaseUrl ? [settings.invidiousBaseUrl] : []),
  ]);
  const preferredPipedBaseUrl = normalizePreferredUpstreamInstance(
    settings.preferredPipedBaseUrl ?? settings.pipedBaseUrl,
    pipedBaseUrls,
  );
  const preferredInvidiousBaseUrl = normalizePreferredUpstreamInstance(
    settings.preferredInvidiousBaseUrl ?? settings.invidiousBaseUrl,
    invidiousBaseUrls,
  );
  return {
    ...settings,
    pipedBaseUrl: pipedBaseUrls[0],
    invidiousBaseUrl: invidiousBaseUrls[0],
    pipedBaseUrls,
    invidiousBaseUrls,
    preferredPipedBaseUrl,
    preferredInvidiousBaseUrl,
  };
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
    return parsed.success
      ? settingsWithNormalizedInstances(parsed.data)
      : defaultSettings;
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
  const pipedBaseUrls =
    patch.pipedBaseUrls !== undefined
      ? normalizeUpstreamInstanceList(patch.pipedBaseUrls)
      : normalizeUpstreamInstanceList([
          ...(previous.pipedBaseUrls ?? []),
          ...(patch.pipedBaseUrl !== undefined ? [patch.pipedBaseUrl] : []),
        ]);
  const invidiousBaseUrls =
    patch.invidiousBaseUrls !== undefined
      ? normalizeUpstreamInstanceList(patch.invidiousBaseUrls)
      : normalizeUpstreamInstanceList([
          ...(previous.invidiousBaseUrls ?? []),
          ...(patch.invidiousBaseUrl !== undefined
            ? [patch.invidiousBaseUrl]
            : []),
        ]);
  const merged: AppSettings = {
    ...previous,
    ...patch,
    tasteKeywords: nextKeywords,
    blockedRecommendationChannels: nextBlockedChannels,
    sponsorBlockCategories: nextSponsorBlockCategories,
    pipedBaseUrl: normalizeUrlLike(pipedBaseUrls[0]),
    invidiousBaseUrl: normalizeUrlLike(invidiousBaseUrls[0]),
    pipedBaseUrls,
    invidiousBaseUrls,
    preferredPipedBaseUrl: normalizePreferredUpstreamInstance(
      patch.preferredPipedBaseUrl ?? previous.preferredPipedBaseUrl,
      pipedBaseUrls,
    ),
    preferredInvidiousBaseUrl: normalizePreferredUpstreamInstance(
      patch.preferredInvidiousBaseUrl ?? previous.preferredInvidiousBaseUrl,
      invidiousBaseUrls,
    ),
    trendingRegion: normalizeTrendingRegionStored(
      patch.trendingRegion ?? previous.trendingRegion,
    ),
  };
  const safe = appSettingsSchema.parse(settingsWithNormalizedInstances(merged));
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
  if (
    settings.pipedBaseUrls.length === 0 &&
    settings.invidiousBaseUrls.length === 0
  ) {
    return undefined;
  }
  return {
    pipedBaseUrl: settings.pipedBaseUrl,
    invidiousBaseUrl: settings.invidiousBaseUrl,
    pipedBaseUrls: settings.pipedBaseUrls,
    invidiousBaseUrls: settings.invidiousBaseUrls,
    preferredPipedBaseUrl: settings.preferredPipedBaseUrl,
    preferredInvidiousBaseUrl: settings.preferredInvidiousBaseUrl,
  };
}
