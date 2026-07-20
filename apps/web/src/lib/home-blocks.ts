/**
 * The modular home page is a user-ordered list of blocks, each mirroring a
 * sidebar section (or one specific playlist). Stored in the settings profile;
 * shared between the schema (server) and the home renderer (client).
 */

export const HOME_BLOCK_TYPES = [
  "subscriptions",
  "recommended",
  "explore",
  "history",
  "queue",
  "saved",
  "playlists",
  "playlist",
] as const;

export type HomeBlockType = (typeof HOME_BLOCK_TYPES)[number];

export type HomeBlockLayout = "cards" | "rows";

/**
 * Item size presets. Responsive by construction: for cards the preset sets
 * the *minimum column width* of an auto-fill grid (column count adapts to the
 * viewport); for rows it sets the thumbnail width.
 */
export const HOME_BLOCK_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;
export type HomeBlockSize = (typeof HOME_BLOCK_SIZES)[number];

export const HOME_BLOCK_SIZE_LABEL: Record<HomeBlockSize, string> = {
  xs: "XS",
  sm: "S",
  md: "M",
  lg: "L",
  xl: "XL",
};

/** Minimum card column width per size (cards layout). */
export const CARD_MIN_WIDTH_PX: Record<HomeBlockSize, number> = {
  xs: 180,
  sm: 230,
  md: 280,
  lg: 360,
  xl: 440,
};

export type HomeBlock = {
  /** Stable identity for reordering (nanoid-ish string). */
  id: string;
  type: HomeBlockType;
  /** Only for type "playlist" — the local playlist to show. */
  playlistId?: number;
  /** Max items shown (rows layout). */
  limit: number;
  /**
   * Full grid rows shown (cards layout): items = measured columns × rows, so
   * the last row is never ragged at any viewport width.
   */
  rows: number;
  layout: HomeBlockLayout;
  size: HomeBlockSize;
  /**
   * Values for this block's section options (keys from SECTION_OPTIONS).
   * Independent from the section page's own value for the same option.
   */
  options?: Record<string, boolean>;
};

export type SectionOptionDef = {
  key: string;
  label: string;
  defaultValue: boolean;
};

/**
 * The single *definition* base: options declared once per section appear
 * automatically wherever that section renders (its page and its home
 * blocks) — while every surface keeps its own value.
 */
const HIDE_WATCHED: SectionOptionDef = {
  key: "hideFinished",
  label: "Hide watched videos",
  defaultValue: false,
};

/**
 * Default mirrors the profile-level `hideShortsInSubscriptions` default (true)
 * so untouched blocks keep today's behavior; once set, the block value
 * overrides the profile setting for this block only.
 */
const HIDE_SHORTS: SectionOptionDef = {
  key: "hideShorts",
  label: "Hide Shorts",
  defaultValue: true,
};

/**
 * The feed already drops ignored videos server-side, so this defaults on; the
 * option exists to (a) show them again when you want to review/undo, and (b)
 * make an Ignore press remove the card from the block immediately.
 */
const HIDE_IGNORED: SectionOptionDef = {
  key: "hideIgnored",
  label: "Hide ignored videos",
  defaultValue: true,
};

export const SECTION_OPTIONS: Partial<
  Record<HomeBlockType, SectionOptionDef[]>
> = {
  subscriptions: [HIDE_WATCHED, HIDE_SHORTS, HIDE_IGNORED],
  queue: [HIDE_WATCHED],
  saved: [HIDE_WATCHED],
  playlist: [HIDE_WATCHED],
  history: [
    {
      key: "hideCompleted",
      label: "Hide watched videos",
      defaultValue: false,
    },
  ],
};

export function homeBlockOption(block: HomeBlock, key: string): boolean {
  const def = SECTION_OPTIONS[block.type]?.find((o) => o.key === key);
  return block.options?.[key] ?? def?.defaultValue ?? false;
}

/** Option-key prefix marking a per-block tag include/exclude toggle. */
export const TAG_OPTION_PREFIX = "tag:";

/** Include/exclude tag lists a block filters its feed by. */
export function blockTagLists(block: HomeBlock): {
  includeTags: string[] | undefined;
  excludeTags: string[] | undefined;
} {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const [key, value] of Object.entries(block.options ?? {})) {
    if (!key.startsWith(TAG_OPTION_PREFIX)) continue;
    const tag = key.slice(TAG_OPTION_PREFIX.length);
    if (value === true) include.push(tag);
    else if (value === false) exclude.push(tag);
  }
  return {
    includeTags: include.length > 0 ? include : undefined,
    excludeTags: exclude.length > 0 ? exclude : undefined,
  };
}

/** True when the block renders as one horizontally scrollable shelf. */
export function isScrollRow(block: HomeBlock): boolean {
  return block.rows === 1 && (block.options?.scrollRow ?? false);
}

/** Items a block needs at most: full rows on wide screens, or N list rows. */
export function blockFetchCount(block: HomeBlock): number {
  if (isScrollRow(block)) return 48;
  return block.layout === "cards" ? block.rows * 8 : block.rows;
}

export const HOME_BLOCK_LABEL: Record<HomeBlockType, string> = {
  subscriptions: "Subscriptions",
  recommended: "Recommended",
  explore: "Explore",
  history: "History",
  queue: "Queue",
  saved: "Saved",
  playlists: "Playlists",
  playlist: "Playlist",
};

/** Where the block heading links to. */
export function homeBlockHref(block: HomeBlock): string {
  switch (block.type) {
    case "subscriptions":
      return "/subscriptions";
    case "recommended":
      return "/recommended";
    case "explore":
      return "/trending";
    case "history":
      return "/history";
    case "queue":
      return "/queue";
    case "saved":
      return "/saved";
    case "playlists":
      return "/playlists";
    case "playlist":
      return block.playlistId != null
        ? `/playlists/${block.playlistId}`
        : "/playlists";
  }
}

export const HOME_BLOCK_ROWS = [1, 2, 3, 4, 6, 8] as const;

export const DEFAULT_HOME_BLOCKS: HomeBlock[] = [
  {
    id: "default-subs",
    type: "subscriptions",
    limit: 8,
    rows: 2,
    layout: "cards",
    size: "md",
  },
  {
    id: "default-queue",
    type: "queue",
    limit: 4,
    rows: 4,
    layout: "rows",
    size: "md",
  },
  {
    id: "default-history",
    type: "history",
    limit: 4,
    rows: 4,
    layout: "rows",
    size: "md",
  },
];

export function newHomeBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
