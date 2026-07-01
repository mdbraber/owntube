import { z } from "zod";
import {
  DEFAULT_SPONSORBLOCK_CATEGORIES,
  normalizeSponsorBlockCategories,
  type SponsorBlockCategory,
  sponsorBlockCategorySchema,
} from "@/lib/sponsorblock";

export const sponsorBlockPrefsSchema = z.object({
  enabled: z.boolean().default(true),
  autoSkip: z.boolean().default(true),
  categories: z
    .array(sponsorBlockCategorySchema)
    .default(DEFAULT_SPONSORBLOCK_CATEGORIES),
});

export type SponsorBlockPrefs = z.infer<typeof sponsorBlockPrefsSchema>;

const STORAGE_KEY = "owntube:sponsorBlockPrefs";

const defaultPrefs: SponsorBlockPrefs = sponsorBlockPrefsSchema.parse({});

export function readSponsorBlockPrefs(): SponsorBlockPrefs {
  if (typeof window === "undefined") return defaultPrefs;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs;
    const json = JSON.parse(raw) as unknown;
    const parsed = sponsorBlockPrefsSchema.safeParse(json);
    if (!parsed.success) return defaultPrefs;
    return {
      ...parsed.data,
      categories: normalizeSponsorBlockCategories(parsed.data.categories),
    };
  } catch {
    return defaultPrefs;
  }
}

export function writeSponsorBlockPrefs(prefs: SponsorBlockPrefs): void {
  if (typeof window === "undefined") return;
  try {
    const safe = sponsorBlockPrefsSchema.parse({
      enabled: prefs.enabled,
      autoSkip: prefs.autoSkip,
      categories: normalizeSponsorBlockCategories(prefs.categories),
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* quota / private mode */
  }
}

export function sponsorBlockPrefsFromAppSettings(settings: {
  sponsorBlockEnabled?: boolean;
  sponsorBlockAutoSkip?: boolean;
  sponsorBlockCategories?: SponsorBlockCategory[];
}): SponsorBlockPrefs {
  return sponsorBlockPrefsSchema.parse({
    enabled: settings.sponsorBlockEnabled ?? true,
    autoSkip: settings.sponsorBlockAutoSkip ?? true,
    categories: normalizeSponsorBlockCategories(
      settings.sponsorBlockCategories,
    ),
  });
}

export function toggleSponsorBlockCategory(
  categories: SponsorBlockCategory[],
  category: SponsorBlockCategory,
): SponsorBlockCategory[] {
  const set = new Set(categories);
  if (set.has(category)) {
    set.delete(category);
  } else {
    set.add(category);
  }
  return normalizeSponsorBlockCategories([...set]);
}
