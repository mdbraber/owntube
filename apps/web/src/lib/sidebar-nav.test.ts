import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_NAV,
  resolveSidebarEntries,
  SIDEBAR_NAV_KEYS,
  type SidebarNavEntry,
  sidebarSlots,
} from "@/lib/sidebar-nav";

const shown = (...keys: string[]): SidebarNavEntry[] =>
  keys.map((key) => ({ key, hidden: false }));

describe("resolveSidebarEntries", () => {
  it("gives the built-in order when nothing is stored", () => {
    expect(resolveSidebarEntries(undefined)).toEqual(DEFAULT_SIDEBAR_NAV.items);
  });

  it("keeps the stored order and hidden flags, dropping unknown and repeated keys", () => {
    const stored = [
      { key: "saved", hidden: true },
      { key: "bogus", hidden: false },
      ...DEFAULT_SIDEBAR_NAV.items,
    ];
    const out = resolveSidebarEntries(stored);
    expect(out).toHaveLength(SIDEBAR_NAV_KEYS.length);
    expect(out[0]).toEqual({ key: "saved", hidden: true });
    expect(out.filter((e) => e.key === "saved")).toHaveLength(1);
  });

  it("adds a missing entry after its built-in predecessor", () => {
    const stored = DEFAULT_SIDEBAR_NAV.items.filter(
      (e) => e.key !== "favorites",
    );
    const keys = resolveSidebarEntries(stored).map((e) => e.key);
    expect(keys.indexOf("favorites")).toBe(keys.indexOf("subs") + 1);
  });
});

describe("sidebarSlots", () => {
  it("renders the default sidebar as before: browse, line, library, line, following", () => {
    const slots = sidebarSlots(DEFAULT_SIDEBAR_NAV.items, { signedIn: true });
    expect(slots.map((s) => (s.kind === "link" ? s.key : s.kind))).toEqual([
      "home",
      "recommended",
      "shorts",
      "explore",
      "divider",
      "library",
      "subs",
      "favorites",
      "playlists",
      "queue",
      "saved",
      "divider",
      "following",
    ]);
  });

  it("drops hidden entries and Following when signed out", () => {
    const entries = [
      ...shown("home"),
      { key: "shorts", hidden: true },
      ...shown("following", "saved"),
    ];
    expect(sidebarSlots(entries, { signedIn: false })).toEqual([
      { kind: "link", key: "home" },
      { kind: "link", key: "saved" },
    ]);
  });

  it("never starts, ends or repeats a separator, and fences Following", () => {
    const entries = shown(
      "divider",
      "home",
      "following",
      "divider",
      "saved",
      "divider",
    );
    expect(sidebarSlots(entries, { signedIn: true })).toEqual([
      { kind: "link", key: "home" },
      { kind: "divider" },
      { kind: "following" },
      { kind: "divider" },
      { kind: "link", key: "saved" },
    ]);
  });
});

describe("settings schema", () => {
  it("defaults the sidebar for profiles saved before it existed, and fills hidden flags", async () => {
    const { appSettingsSchema } = await import("@/server/settings/profile");
    expect(appSettingsSchema.parse({}).sidebarNav).toEqual(DEFAULT_SIDEBAR_NAV);
    expect(
      appSettingsSchema.parse({ sidebarNav: { items: [{ key: "home" }] } })
        .sidebarNav,
    ).toEqual({
      items: [{ key: "home", hidden: false }],
      followingCollapsed: false,
    });
  });
});
