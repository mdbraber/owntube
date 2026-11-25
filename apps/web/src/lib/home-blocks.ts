/**
 * The modular home page is a user-ordered list of blocks, each mirroring a
 * sidebar section (or one specific playlist). Stored in the settings profile;
 * shared between the schema (server) and the home renderer (client).
 */

export const HOME_BLOCK_TYPES = [
  "subscriptions",
  "favorites",
  "tag",
  "recommended",
  "explore",
  "history",
  "queue",
  "saved",
  "playlists",
  "playlist",
] as const;

export type HomeBlockType = (typeof HOME_BLOCK_TYPES)[number];

/**
 * How a block arranges its videos: a grid of cards (a number of full rows),
 * one horizontally scrolling row that runs to the end of the source, or a
 * vertical list (a number of lines, thumbnail beside the title).
 */
export const HOME_BLOCK_LAYOUTS = ["cards", "row", "list"] as const;
export type HomeBlockLayout = (typeof HOME_BLOCK_LAYOUTS)[number];

export const HOME_BLOCK_LAYOUT_LABEL: Record<HomeBlockLayout, string> = {
  cards: "Cards",
  row: "Row",
  list: "List",
};

/**
 * Stored blocks from before the Row layout: "rows" was the vertical list, and
 * a one-row card grid with the `scrollRow` option was the scrolling row.
 */
export function migrateHomeBlockLayout(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const block = raw as Record<string, unknown>;
  const { scrollRow, ...options } = (block.options ?? {}) as Record<
    string,
    unknown
  >;
  const layout =
    scrollRow === true && block.rows === 1
      ? "row"
      : block.layout === "rows"
        ? "list"
        : block.layout;
  return block.options === undefined
    ? { ...block, layout }
    : { ...block, layout, options };
}

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
  /** Optional heading override (used by "tag" blocks; default is the tags). */
  title?: string;
  /** Legacy max items (unused; the list layout shows `rows` lines). */
  limit: number;
  /**
   * Cards: full grid rows shown (items = measured columns × rows, so the
   * last row is never ragged at any viewport width). List: lines shown.
   * Row: unused (the row runs to the end of its source).
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

/**
 * Tag blocks: a channel must carry *every* included tag instead of any one of
 * them, so a bundle like #music + #live narrows rather than widens.
 */
const MATCH_ALL_TAGS: SectionOptionDef = {
  key: "matchAll",
  label: "Channels must have all included tags",
  defaultValue: false,
};

export const SECTION_OPTIONS: Partial<
  Record<HomeBlockType, SectionOptionDef[]>
> = {
  subscriptions: [HIDE_WATCHED, HIDE_SHORTS, HIDE_IGNORED],
  favorites: [HIDE_WATCHED, HIDE_SHORTS, HIDE_IGNORED],
  tag: [MATCH_ALL_TAGS, HIDE_WATCHED, HIDE_SHORTS, HIDE_IGNORED],
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

/** Block types whose feed is the merged subscription uploads. */
export function isSubscriptionFeedBlock(type: HomeBlockType): boolean {
  return type === "subscriptions" || type === "favorites" || type === "tag";
}

/** Block types whose options carry per-tag include/exclude toggles. */
export function hasTagFilter(type: HomeBlockType): boolean {
  return type === "subscriptions" || type === "tag";
}

/**
 * Channel filter for a subscription-feed block, in the shape
 * `subscriptions.mergedFeedInfinite` and `subscriptions.listTagged` take.
 * Favorites resolve their tag on the server, so renaming the favorite tag in
 * settings never leaves a stale block behind.
 */
export type TagFeedFilter = {
  includeTags?: string[];
  excludeTags?: string[];
  tagMatch?: "any" | "all";
  favorites?: boolean;
};

export function blockFeedFilter(block: HomeBlock): TagFeedFilter {
  switch (block.type) {
    case "favorites":
      return { favorites: true };
    case "tag": {
      const lists = blockTagLists(block);
      return {
        ...lists,
        tagMatch: homeBlockOption(block, "matchAll") ? "all" : "any",
      };
    }
    default:
      return blockTagLists(block);
  }
}

/** "#music + #live" for match-all, "#music · #jazz" for match-any. */
export function tagBundleLabel(
  tags: string[] | undefined,
  tagMatch: "any" | "all" = "any",
): string {
  if (!tags || tags.length === 0) return "Tag";
  return tags.map((t) => `#${t}`).join(tagMatch === "all" ? " + " : " · ");
}

/** Heading for a block; a "playlist" block needs its name passed in. */
export function homeBlockTitle(
  block: HomeBlock,
  playlistName?: string,
): string {
  const custom = block.title?.trim();
  if (custom) return custom;
  if (block.type === "playlist") return playlistName ?? "Playlist";
  if (block.type === "tag") {
    const { includeTags, tagMatch } = blockFeedFilter(block);
    return tagBundleLabel(includeTags, tagMatch);
  }
  return HOME_BLOCK_LABEL[block.type];
}

/** Query string for the /tags page showing a tag bundle. */
export function tagViewHref(filter: TagFeedFilter): string {
  const params = new URLSearchParams();
  for (const t of filter.includeTags ?? []) params.append("tag", t);
  for (const t of filter.excludeTags ?? []) params.append("not", t);
  if (filter.tagMatch === "all") params.set("match", "all");
  const qs = params.toString();
  return qs ? `/tags?${qs}` : "/subscriptions";
}

/** True when the block renders as one horizontally scrolling row. */
export function isScrollRow(block: HomeBlock): boolean {
  return block.layout === "row";
}

/**
 * Items a block fetches first: full rows on wide screens, N list lines, or a
 * first screenful-and-more for a row (which then loads on as it's scrolled).
 */
export function blockFetchCount(block: HomeBlock): number {
  if (isScrollRow(block)) return 48;
  return block.layout === "cards" ? block.rows * 8 : block.rows;
}

export const HOME_BLOCK_LABEL: Record<HomeBlockType, string> = {
  subscriptions: "Subscriptions",
  favorites: "Favorites",
  tag: "Tag",
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
    case "favorites":
      return "/favorites";
    case "tag":
      return tagViewHref(blockFeedFilter(block));
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
    layout: "list",
    size: "md",
  },
  {
    id: "default-history",
    type: "history",
    limit: 4,
    rows: 4,
    layout: "list",
    size: "md",
  },
];

export function newHomeBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
