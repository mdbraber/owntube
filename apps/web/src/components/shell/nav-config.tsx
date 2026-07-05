import type { ReactNode } from "react";

export type NavKey =
  | "home"
  | "shorts"
  | "explore"
  | "subs"
  | "library"
  | "algorithm"
  | "queue"
  | "saved";

type NavItem = {
  key: NavKey;
  href: string;
  label: string;
  icon: ReactNode;
  /** Filled variant shown when the item is the current page. */
  iconActive?: ReactNode;
};

const HomeIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Home</title>
    <path d="M3 9.6 12 3l9 6.6V20a1.5 1.5 0 0 1-1.5 1.5H15v-6.5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6.5H4.5A1.5 1.5 0 0 1 3 20z" />
  </svg>
);

const HomeIconActive = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Home</title>
    <path
      d="M3 9.6 12 3l9 6.6V20a1.5 1.5 0 0 1-1.5 1.5H15v-6.5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6.5H4.5A1.5 1.5 0 0 1 3 20z"
      fill="currentColor"
    />
  </svg>
);

const ShortsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Shorts</title>
    <rect x="6.5" y="2.5" width="11" height="19" rx="3.5" />
    <path d="M10.4 8.7 15.4 12l-5 3.3z" fill="currentColor" stroke="none" />
  </svg>
);

const ShortsIconActive = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
    <title>Shorts</title>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      fill="currentColor"
      d="M10 2.5h4A3.5 3.5 0 0 1 17.5 6v12a3.5 3.5 0 0 1-3.5 3.5h-4A3.5 3.5 0 0 1 6.5 18V6A3.5 3.5 0 0 1 10 2.5Zm.4 6.2 5 3.3-5 3.3z"
    />
  </svg>
);

const ExploreIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Explore</title>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z" />
    <path d="M11.6 12.4h.01" />
  </svg>
);

const ExploreIconActive = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
    <title>Explore</title>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      fill="currentColor"
      d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.6 5.4-2.1 5.1-5.1 2.1 2.1-5.1z"
    />
  </svg>
);

const SubscriptionsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Subscriptions</title>
    <path d="M6 4.5h12" />
    <path d="M4 8h16" />
    <rect x="2.5" y="11.5" width="19" height="9.5" rx="2.5" />
    <path d="M10 14.6 14 16.75l-4 2.15z" fill="currentColor" stroke="none" />
  </svg>
);

const SubscriptionsIconActive = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Subscriptions</title>
    <path d="M6 4.5h12" />
    <path d="M4 8h16" />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      fill="currentColor"
      stroke="none"
      d="M5 11.5h14a2.5 2.5 0 0 1 2.5 2.5v4.5a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5V14A2.5 2.5 0 0 1 5 11.5Zm5 3.1 4 2.15-4 2.15z"
    />
  </svg>
);

const HistoryIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>History</title>
    <path d="M3 3v5h5" />
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8" />
    <path d="M12 7.5V12l3.5 2" />
  </svg>
);

const AlgorithmIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Algorithm</title>
    <path d="M5 3v6.2M5 13.8V21" />
    <circle cx="5" cy="11.5" r="2.3" />
    <path d="M12 3v3.2M12 10.8V21" />
    <circle cx="12" cy="8.5" r="2.3" />
    <path d="M19 3v9.2M19 16.8V21" />
    <circle cx="19" cy="14.5" r="2.3" />
  </svg>
);

const AlgorithmIconActive = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Algorithm</title>
    <path d="M5 3v6.2M5 13.8V21" />
    <circle cx="5" cy="11.5" r="2.3" fill="currentColor" />
    <path d="M12 3v3.2M12 10.8V21" />
    <circle cx="12" cy="8.5" r="2.3" fill="currentColor" />
    <path d="M19 3v9.2M19 16.8V21" />
    <circle cx="19" cy="14.5" r="2.3" fill="currentColor" />
  </svg>
);

const PlaylistsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Playlists</title>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

const SettingsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Settings</title>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

/** Full primary navigation list rendered in the desktop sidebar. */
const SavedIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Saved</title>
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
  </svg>
);

const QueueIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Queue</title>
    <path d="M4 6h11M4 12h11M4 18h7M17 15v6M20 18h-6" />
  </svg>
);

export const SIDEBAR_NAV: NavItem[] = [
  {
    key: "home",
    href: "/",
    label: "Home",
    icon: HomeIcon,
    iconActive: HomeIconActive,
  },
  {
    key: "shorts",
    href: "/shorts",
    label: "Shorts",
    icon: ShortsIcon,
    iconActive: ShortsIconActive,
  },
  {
    key: "explore",
    href: "/trending",
    label: "Explore",
    icon: ExploreIcon,
    iconActive: ExploreIconActive,
  },
  {
    key: "subs",
    href: "/subscriptions",
    label: "Subscriptions",
    icon: SubscriptionsIcon,
    iconActive: SubscriptionsIconActive,
  },
  {
    key: "queue",
    href: "/queue",
    label: "Queue",
    icon: QueueIcon,
  },
  {
    key: "saved",
    href: "/saved",
    label: "Saved",
    icon: SavedIcon,
  },
  // History stays outline when active: the glyph is an arc + arrow with no
  // fillable body, so a filled variant would lose its identity.
  { key: "library", href: "/history", label: "History", icon: HistoryIcon },
  {
    key: "algorithm",
    href: "/dashboard",
    label: "Algorithm",
    icon: AlgorithmIcon,
    iconActive: AlgorithmIconActive,
  },
];

/** Subset shown as tabs in the mobile bottom bar (account button is added separately). */
export const BOTTOM_NAV: NavItem[] = SIDEBAR_NAV.filter((n) =>
  (["home", "shorts", "explore", "subs"] as NavKey[]).includes(n.key),
);

/** Sidebar-only entries (live below the primary nav, above the divider). */
export const SECONDARY_NAV: { href: string; label: string; icon: ReactNode }[] =
  [
    { href: "/playlists", label: "Playlists", icon: PlaylistsIcon },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ];

/** Links surfaced inside the account menu (desktop dropdown + mobile sheet). */
export const ACCOUNT_LINKS: { href: string; label: string; icon: ReactNode }[] =
  [
    { href: "/settings", label: "Settings", icon: SettingsIcon },
    { href: "/history", label: "History", icon: HistoryIcon },
    { href: "/playlists", label: "Playlists", icon: PlaylistsIcon },
    { href: "/queue", label: "Queue", icon: QueueIcon },
    { href: "/saved", label: "Saved", icon: SavedIcon },
    { href: "/subscriptions", label: "Subscriptions", icon: SubscriptionsIcon },
    { href: "/dashboard", label: "Algorithm", icon: AlgorithmIcon },
  ];

export function activeForPath(
  pathname: string,
  href: string,
  key: NavKey,
): boolean {
  if (href === "/") return pathname === "/";
  if (key === "explore") {
    return pathname === "/trending" || pathname.startsWith("/trending");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
