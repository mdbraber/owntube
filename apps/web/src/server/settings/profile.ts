import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_BOTTOM_NAV_KEYS,
  MAX_BOTTOM_NAV,
  MIN_BOTTOM_NAV,
} from "@/lib/bottom-nav";
import {
  CHANNEL_TAG_MAX_LEN,
  DEFAULT_FAVORITE_TAG,
  normalizeChannelTag,
} from "@/lib/channel-tag";
import { defaultPlaybackQualitySchema } from "@/lib/default-playback-quality";
import {
  DEFAULT_HOME_BLOCKS,
  HOME_BLOCK_LAYOUTS,
  HOME_BLOCK_TYPES,
  migrateHomeBlockLayout,
} from "@/lib/home-blocks";
import {
  DEFAULT_QUICK_ACTIONS,
  LEGACY_DEFAULT_QUICK_ACTIONS_LIST,
  QUICK_ACTION_VALUES,
} from "@/lib/quick-actions";
import { DEFAULT_SIDEBAR_NAV } from "@/lib/sidebar-nav";
import {
  DEFAULT_SPONSORBLOCK_CATEGORIES,
  normalizeSponsorBlockCategories,
  sponsorBlockCategorySchema,
} from "@/lib/sponsorblock";
import type { AppDb } from "@/server/db/client";
import { userProfile } from "@/server/db/schema";

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

/**
 * Subscription-feed pages (Subscriptions, Favorites, tag pages) take the home
 * block options too: layout, a row cap (0 = all, infinite scroll) and the
 * Shorts / ignored filters. hideShorts unset follows the profile-level
 * hideShortsInSubscriptions; rowSize is the card/row size on every tab.
 */
const DEFAULT_FEED_PAGE_PREFS = {
  ...DEFAULT_SECTION_PAGE_PREFS,
  layout: "cards",
  rows: 0,
  hideIgnored: true,
} as const;
const feedPagePrefsObject = (hideIgnored: boolean) =>
  z.object({
    hideCompleted: z.boolean().default(false),
    rowSize: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
    layout: z.enum(["cards", "rows"]).default("cards"),
    rows: z.number().int().min(0).max(8).default(0),
    hideShorts: z.boolean().optional(),
    hideIgnored: z.boolean().default(hideIgnored),
  });
const feedPagePrefsSchema = feedPagePrefsObject(true).default(
  DEFAULT_FEED_PAGE_PREFS,
);
/**
 * Channel pages (one set for all channels). Ignored videos stay visible but
 * dimmed by default, as before; Shorts have their own tab, so hideShorts is
 * unused here.
 */
const DEFAULT_CHANNEL_PAGE_PREFS = {
  ...DEFAULT_FEED_PAGE_PREFS,
  hideIgnored: false,
} as const;
const channelPagePrefsSchema = feedPagePrefsObject(false).default(
  DEFAULT_CHANNEL_PAGE_PREFS,
);

export const appSettingsSchema = z.object({
  theme: themeSchema.default("system"),
  visualTheme: visualThemeSchema.default("default"),
  /** ISO 3166-1 alpha-2 region (Shorts discovery). */
  trendingRegion: z.string().length(2).default("US"),
  /** Topics / phrases used to bias the recommendation title similarity corpus. */
  tasteKeywords: z.array(tasteKeywordSchema).max(96).default([]),
  /** Unix seconds when the user finished the taste onboarding flow. */
  tasteOnboardingCompletedAt: z.number().int().optional(),
  /** Unix seconds when the user skipped the taste onboarding flow. */
  tasteOnboardingSkippedAt: z.number().int().optional(),
  /** Hide members/subscribers-only videos when detected in list titles. */
  /** Hide YouTube Shorts from the subscriptions feed (UULF long-form allowlist + duration/#shorts fallback). */
  hideShortsInSubscriptions: z.boolean().default(true),
  /** Start watch page with cinema mode enabled. */
  defaultCinemaMode: z.boolean().default(false),
  /**
   * Start each episode description in the playlist, queue and saved podcast
   * feeds with the memos on that video. Off: memos are private notes, and a
   * feed reaches a podcast app.
   */
  includeMemosInFeeds: z.boolean().default(false),
  /** Keep a mini player when leaving watch page. */
  enableMiniPlayer: z.boolean().default(true),
  /** Start playing automatically when the watch page opens. */
  autoplayOnWatch: z.boolean().default(true),
  /** Auto-advance to the next queued/related video when one ends. */
  autoplayNext: z.boolean().default(true),
  /** Default watch-page quality rung (1080p, 720p, muxed 360p, …). */
  defaultPlaybackQuality: defaultPlaybackQualitySchema.default("1080p"),
  /**
   * DASH: jump to the single best available quality on entering fullscreen,
   * then revert to whatever was active (default-capped auto, or a manual
   * pick) on exit. Off by default — it's an explicit bandwidth-usage opt-in.
   */
  fullscreenAutoBestQuality: z.boolean().default(false),
  /**
   * Buffer the next short's video ahead of time so swiping starts it instantly.
   * Costs extra bandwidth (downloads a short you might skip) — off-switch for
   * metered connections.
   */
  shortsPreloadNext: z.boolean().default(true),
  /** Channels excluded from personalized recommendations. */
  blockedRecommendationChannels: z
    .array(z.string().min(1).max(128))
    .max(200)
    .default([]),
  /**
   * Keep uploads from channels you already subscribe to out of personalized
   * recommendations (they're still in your Subscriptions feed). On by default:
   * recommendations are a discovery surface. Can be turned off.
   */
  excludeSubscribedFromRecommendations: z.boolean().default(true),
  /**
   * Recommended feed shows only personalized picks — no regional-trending tail.
   * The pool digs deeper into related videos to compensate for the dropped
   * tail, so you get more discovery instead of trending filler. On by default;
   * can be turned off to blend regional trending back in.
   */
  personalizedFeedOnly: z.boolean().default(true),
  /**
   * Caption language a video starts on when captions are on: "original" (the
   * video's own language) or a BCP-47 tag, falling back to the original when
   * a video lacks it. See lib/caption-default.ts.
   */
  captionLanguage: z
    .string()
    .regex(/^(original|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/)
    .default("original"),
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
      // Profiles that stored a superseded default verbatim follow the new one.
      Array.isArray(value) &&
      LEGACY_DEFAULT_QUICK_ACTIONS_LIST.some(
        (legacy) => legacy.join(",") === value.join(","),
      )
        ? DEFAULT_QUICK_ACTIONS
        : value,
    z.array(quickActionSchema).max(4).default(DEFAULT_QUICK_ACTIONS),
  ),
  /**
   * The channel tag the favorite button toggles. Favorites (sidebar page and
   * home block) are the subscribed channels carrying it. Stored normalized.
   */
  favoriteTag: z
    .string()
    .min(1)
    .max(CHANNEL_TAG_MAX_LEN)
    .default(DEFAULT_FAVORITE_TAG),
  /** Ordered blocks of the modular home page. */
  homeBlocks: z
    .array(
      z.preprocess(
        migrateHomeBlockLayout,
        z.object({
          id: z.string().min(1).max(64),
          type: z.enum(HOME_BLOCK_TYPES),
          playlistId: z.number().int().positive().optional(),
          /** Heading override (tag blocks). */
          title: z.string().trim().max(60).optional(),
          limit: z.number().int().min(1).max(24).default(8),
          rows: z.number().int().min(1).max(8).default(2),
          layout: z.enum(HOME_BLOCK_LAYOUTS).default("cards"),
          size: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
          /** Section-option values for this block (independent of the page's). */
          options: z.record(z.string(), z.boolean()).optional(),
        }),
      ),
    )
    .max(16)
    .default(DEFAULT_HOME_BLOCKS),
  /**
   * Ordered nav keys shown as tabs in the mobile bottom bar (1–5). Everything
   * else lives under the Account button. Stored as plain strings — the renderer
   * maps known keys to items and ignores any it doesn't recognize.
   */
  bottomNav: z
    .array(z.string().min(1).max(32))
    .min(MIN_BOTTOM_NAV)
    .max(MAX_BOTTOM_NAV)
    .default([...DEFAULT_BOTTOM_NAV_KEYS]),
  /**
   * Desktop sidebar: ordered entries (nav keys, plus `divider` and
   * `following`), each shown or hidden, and whether the Following list is
   * collapsed. Unknown keys are ignored and missing ones added by the
   * renderer (`resolveSidebarEntries`), like `bottomNav`.
   */
  sidebarNav: z
    .object({
      items: z
        .array(
          z.object({
            key: z.string().min(1).max(32),
            hidden: z.boolean().default(false),
          }),
        )
        .max(32),
      followingCollapsed: z.boolean().default(false),
    })
    .default(DEFAULT_SIDEBAR_NAV),
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
      /** Subscriptions (all tabs). Defaults in, for profiles saved before it. */
      subscriptions: feedPagePrefsSchema,
      favorites: feedPagePrefsSchema,
      /** Every /tags page (tag bundles share one set of options). */
      tags: feedPagePrefsSchema,
      /** Every channel page. */
      channel: channelPagePrefsSchema,
    })
    .default({
      history: DEFAULT_SECTION_PAGE_PREFS,
      queue: DEFAULT_SECTION_PAGE_PREFS,
      saved: DEFAULT_SECTION_PAGE_PREFS,
      subscriptions: DEFAULT_FEED_PAGE_PREFS,
      favorites: DEFAULT_FEED_PAGE_PREFS,
      tags: DEFAULT_FEED_PAGE_PREFS,
      channel: DEFAULT_CHANNEL_PAGE_PREFS,
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
  trendingRegion: "US",
  tasteKeywords: [],
  hideShortsInSubscriptions: true,
  defaultCinemaMode: false,
  includeMemosInFeeds: false,
  enableMiniPlayer: true,
  autoplayOnWatch: true,
  autoplayNext: true,
  shortsPreloadNext: true,
  defaultPlaybackQuality: "1080p",
  fullscreenAutoBestQuality: false,
  captionLanguage: "original",
  blockedRecommendationChannels: [],
  excludeSubscribedFromRecommendations: true,
  personalizedFeedOnly: true,
  sponsorBlockEnabled: true,
  sponsorBlockAutoSkip: true,
  sponsorBlockCategories: DEFAULT_SPONSORBLOCK_CATEGORIES,
  enableSwipeGestures: true,
  swipeGestures: {
    left: "ignore",
    right: "queue",
  },
  quickActions: DEFAULT_QUICK_ACTIONS,
  favoriteTag: DEFAULT_FAVORITE_TAG,
  homeBlocks: DEFAULT_HOME_BLOCKS,
  bottomNav: [...DEFAULT_BOTTOM_NAV_KEYS],
  sidebarNav: DEFAULT_SIDEBAR_NAV,
  sectionPrefs: {
    history: DEFAULT_SECTION_PAGE_PREFS,
    queue: DEFAULT_SECTION_PAGE_PREFS,
    saved: DEFAULT_SECTION_PAGE_PREFS,
    subscriptions: DEFAULT_FEED_PAGE_PREFS,
    favorites: DEFAULT_FEED_PAGE_PREFS,
    tags: DEFAULT_FEED_PAGE_PREFS,
    channel: DEFAULT_CHANNEL_PAGE_PREFS,
  },
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Drops videos from channels the user asked not to be recommended. Applies to
 * every recommendation-like list (home pool, watch-page related), not only the
 * personalised feed.
 */
export function withoutBlockedChannels<T extends { channelId?: string | null }>(
  videos: T[],
  settings: Pick<AppSettings, "blockedRecommendationChannels"> | null,
): T[] {
  const blocked = settings?.blockedRecommendationChannels;
  if (!blocked || blocked.length === 0) return videos;
  const set = new Set(blocked);
  return videos.filter((v) => !(v.channelId && set.has(v.channelId)));
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
    if (out.length >= 96) break;
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
    favoriteTag:
      patch.favoriteTag !== undefined
        ? (normalizeChannelTag(patch.favoriteTag) ?? previous.favoriteTag)
        : previous.favoriteTag,
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
