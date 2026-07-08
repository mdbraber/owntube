/**
 * The modular home page is a user-ordered list of blocks, each mirroring a
 * sidebar section (or one specific playlist). Stored in the settings profile;
 * shared between the schema (server) and the home renderer (client).
 */

export const HOME_BLOCK_TYPES = [
  "subscriptions",
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
export const HOME_BLOCK_SIZES = ["xs", "sm", "md", "lg"] as const;
export type HomeBlockSize = (typeof HOME_BLOCK_SIZES)[number];

export const HOME_BLOCK_SIZE_LABEL: Record<HomeBlockSize, string> = {
  xs: "XS",
  sm: "S",
  md: "M",
  lg: "L",
};

/** Minimum card column width per size (cards layout). */
export const CARD_MIN_WIDTH_PX: Record<HomeBlockSize, number> = {
  xs: 180,
  sm: 230,
  md: 280,
  lg: 360,
};

export type HomeBlock = {
  /** Stable identity for reordering (nanoid-ish string). */
  id: string;
  type: HomeBlockType;
  /** Only for type "playlist" — the local playlist to show. */
  playlistId?: number;
  /** Max items shown. */
  limit: number;
  layout: HomeBlockLayout;
  size: HomeBlockSize;
};

export const HOME_BLOCK_LABEL: Record<HomeBlockType, string> = {
  subscriptions: "Subscriptions",
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

export const HOME_BLOCK_LIMITS = [4, 8, 12, 16] as const;

export const DEFAULT_HOME_BLOCKS: HomeBlock[] = [
  {
    id: "default-subs",
    type: "subscriptions",
    limit: 8,
    layout: "cards",
    size: "md",
  },
  { id: "default-queue", type: "queue", limit: 4, layout: "rows", size: "md" },
  {
    id: "default-history",
    type: "history",
    limit: 4,
    layout: "rows",
    size: "md",
  },
];

export function newHomeBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
