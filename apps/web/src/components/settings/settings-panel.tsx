"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ApiTokensSection } from "@/components/settings/api-tokens-section";
import { BottomNavEditor } from "@/components/settings/bottom-nav-editor";
import { RssFeedsSection } from "@/components/settings/rss-feeds-section";
import {
  Segmented,
  SettingRow,
  SettingsSection,
  selectClassName,
  ToggleRow,
} from "@/components/settings/settings-ui";
import { SidebarNavEditor } from "@/components/settings/sidebar-nav-editor";
import { TakeoutImportPanel } from "@/components/settings/takeout-import-panel";
import {
  type SaveState,
  type SettingsPatch,
  useSettingsPatch,
} from "@/components/settings/use-settings-patch";
import { Button } from "@/components/ui/button";
import { captionLanguageOptions } from "@/lib/caption-default";
import {
  DEFAULT_PLAYBACK_QUALITY_SELECT_OPTIONS,
  type DefaultPlaybackQuality,
  writeDefaultPlaybackQuality,
} from "@/lib/default-playback-quality";
import {
  DEFAULT_QUICK_ACTIONS,
  QUICK_ACTION_LABELS,
  QUICK_ACTION_VALUES,
  type QuickAction,
} from "@/lib/quick-actions";
import {
  SPONSORBLOCK_ALL_CATEGORIES,
  SPONSORBLOCK_CATEGORY_LABELS,
} from "@/lib/sponsorblock";
import {
  sponsorBlockPrefsFromAppSettings,
  toggleSponsorBlockCategory,
  writeSponsorBlockPrefs,
} from "@/lib/sponsorblock-prefs";
import { TRENDING_REGION_OPTIONS } from "@/lib/trending-regions";
import { cn } from "@/lib/utils";
import { writeWatchMiniEnabled } from "@/lib/watch-mini-player-state";
import type { AppSettings } from "@/server/settings/profile";
import { useThemeStore } from "@/stores/theme-store";
import { trpc } from "@/trpc/react";

type SwipeAction = AppSettings["swipeGestures"]["left"];

const SECTIONS = [
  { id: "appearance", title: "Appearance" },
  { id: "navigation", title: "Navigation" },
  { id: "playback", title: "Playback" },
  { id: "feed", title: "Feed" },
  { id: "actions", title: "Gestures & actions" },
  { id: "sponsorblock", title: "SponsorBlock" },
  { id: "data", title: "Import & export" },
  { id: "integrations", title: "Feeds & tokens" },
  { id: "server", title: "Server" },
] as const;

const sectionTitle = (id: (typeof SECTIONS)[number]["id"]) =>
  SECTIONS.find((s) => s.id === id)?.title ?? id;

const SWIPE_OPTIONS: { value: SwipeAction; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "queue", label: "Add to queue" },
  { value: "saved", label: "Save" },
  { value: "ignore", label: "Ignore" },
  { value: "watched", label: "Mark watched" },
];

/** Puts `value` in quick-action `slot`, keeping each verb in one slot only. */
function assignQuickAction(
  prev: readonly QuickAction[],
  slot: number,
  value: QuickAction | "none",
): QuickAction[] {
  const next = prev.slice(0, 4);
  if (value === "none") return next.filter((_, i) => i !== slot);
  const cleaned = next.filter((a, i) => i === slot || a !== value);
  if (slot < cleaned.length) cleaned[slot] = value;
  else cleaned.push(value);
  return cleaned.slice(0, 4);
}

/** Mirrors that live outside the settings query (localStorage, the theme store). */
function applyLocalMirrors(next: AppSettings) {
  const { setTheme, setVisualTheme } = useThemeStore.getState();
  setTheme(next.theme);
  setVisualTheme(next.visualTheme);
  writeWatchMiniEnabled(next.enableMiniPlayer ?? true);
  writeDefaultPlaybackQuality(next.defaultPlaybackQuality ?? "1080p");
  writeSponsorBlockPrefs(sponsorBlockPrefsFromAppSettings(next));
}

function SaveStatus({
  state,
  error,
}: {
  state: SaveState;
  error: string | null;
}) {
  const text =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? `Not saved: ${error ?? "error"}`
          : "Changes save automatically";
  return (
    <p
      aria-live="polite"
      className={cn(
        "text-xs",
        state === "error"
          ? "text-[hsl(var(--destructive))]"
          : "text-[hsl(var(--muted-foreground))]",
      )}
    >
      {text}
    </p>
  );
}

type SettingsPanelProps = {
  initial: AppSettings;
};

export function SettingsPanel({ initial }: SettingsPanelProps) {
  const { settings, save, state, error } = useSettingsPatch();
  const s: AppSettings = settings ?? initial;

  // The account's values win over whatever this browser remembered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on open.
  useEffect(() => {
    applyLocalMirrors(s);
  }, []);

  const set = (patch: SettingsPatch) => {
    applyLocalMirrors({ ...s, ...patch });
    void save(patch);
  };

  return (
    <div>
      <SectionTabs />
      <div className="mt-6 min-w-0 space-y-10">
        <SaveStatus state={state} error={error} />

        <SettingsSection id="appearance" title={sectionTitle("appearance")}>
          <SettingRow title="Theme">
            <Segmented
              label="Theme"
              value={s.theme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(theme) => set({ theme })}
            />
          </SettingRow>
          <SettingRow title="Style">
            <Segmented
              label="Style"
              value={s.visualTheme}
              options={[
                { value: "default", label: "Default" },
                { value: "terminal", label: "Terminal" },
              ]}
              onChange={(visualTheme) => set({ visualTheme })}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          id="navigation"
          title={sectionTitle("navigation")}
          description="Choose what the menus show and in which order."
        >
          <SettingRow
            stack
            title="Sidebar"
            description="On wider screens. Drag to reorder, switch items off to hide them, and add separators where you want a line. Collapse Following from its heading in the sidebar."
          >
            <SidebarNavEditor />
          </SettingRow>
          <SettingRow
            stack
            title="Bottom bar"
            description="On phones. Drag to reorder the tabs (1–5); the rest are under the Account button."
          >
            <BottomNavEditor />
          </SettingRow>
        </SettingsSection>

        <SettingsSection id="playback" title={sectionTitle("playback")}>
          <PlaybackSelects s={s} set={set} />
          <ToggleRow
            title="Best quality in fullscreen"
            description="Switches up while fullscreen and back on exit. Uses more data."
            checked={s.fullscreenAutoBestQuality}
            onChange={(v) => set({ fullscreenAutoBestQuality: v })}
          />
          <ToggleRow
            title="Autoplay on the watch page"
            checked={s.autoplayOnWatch}
            onChange={(v) => set({ autoplayOnWatch: v })}
          />
          <ToggleRow
            title="Cinema mode by default"
            checked={s.defaultCinemaMode}
            onChange={(v) => set({ defaultCinemaMode: v })}
          />
          <ToggleRow
            title="Mini-player"
            description="Keep playing in a small player when you leave the watch page."
            checked={s.enableMiniPlayer}
            onChange={(v) => set({ enableMiniPlayer: v })}
          />
          <ToggleRow
            title="Preload the next short"
            description="Faster swipes in Shorts, more data."
            checked={s.shortsPreloadNext}
            onChange={(v) => set({ shortsPreloadNext: v })}
          />
        </SettingsSection>

        <SettingsSection id="feed" title={sectionTitle("feed")}>
          <RegionRow s={s} set={set} />
          <ToggleRow
            title="Hide Shorts in Subscriptions"
            checked={s.hideShortsInSubscriptions}
            onChange={(v) => set({ hideShortsInSubscriptions: v })}
          />
          <FavoriteTagRow
            value={s.favoriteTag}
            onSave={(favoriteTag) => set({ favoriteTag })}
          />
          <SettingRow
            title="Recommendations"
            description="Set interest keywords and rate sample videos. Likes, dislikes and saves shape your feed too."
          >
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/onboarding/taste?manual=1">Refine</Link>
            </Button>
          </SettingRow>
        </SettingsSection>

        <SettingsSection id="actions" title={sectionTitle("actions")}>
          <ToggleRow
            title="Swipe gestures"
            description="Swipe video cards on Home, Explore and Subscriptions (touch screens)."
            checked={s.enableSwipeGestures}
            onChange={(v) => set({ enableSwipeGestures: v })}
          />
          {(["left", "right"] as const).map((dir) => (
            <SwipeRow key={dir} dir={dir} s={s} set={set} />
          ))}
          <QuickActionsRow s={s} set={set} />
        </SettingsSection>

        <SettingsSection
          id="sponsorblock"
          title={sectionTitle("sponsorblock")}
          description={
            <>
              Community-marked segments from{" "}
              <a
                href="https://sponsor.ajay.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[hsl(var(--primary))] hover:underline"
              >
                SponsorBlock
              </a>
              , shown on the player timeline.
            </>
          }
        >
          <ToggleRow
            title="Show segments"
            checked={s.sponsorBlockEnabled}
            onChange={(v) => set({ sponsorBlockEnabled: v })}
          />
          <ToggleRow
            title="Skip segments automatically"
            checked={s.sponsorBlockAutoSkip}
            disabled={!s.sponsorBlockEnabled}
            onChange={(v) => set({ sponsorBlockAutoSkip: v })}
          />
          <SettingRow
            stack
            title="Categories"
            disabled={!s.sponsorBlockEnabled}
          >
            <div className="flex flex-wrap gap-2">
              {SPONSORBLOCK_ALL_CATEGORIES.map((category) => {
                const on = s.sponsorBlockCategories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={on}
                    disabled={!s.sponsorBlockEnabled}
                    onClick={() =>
                      set({
                        sponsorBlockCategories: toggleSponsorBlockCategory(
                          s.sponsorBlockCategories,
                          category,
                        ),
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed",
                      on
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                    )}
                  >
                    {SPONSORBLOCK_CATEGORY_LABELS[category]}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </SettingsSection>

        <SettingsSection id="data" title={sectionTitle("data")}>
          <DataExportRows />
          <TakeoutImportPanel />
        </SettingsSection>

        <SettingsSection id="integrations" title={sectionTitle("integrations")}>
          <RssFeedsSection />
          <ApiTokensSection />
        </SettingsSection>

        <SettingsSection
          id="server"
          title={sectionTitle("server")}
          description={
            <>
              OwnTube reads YouTube through its gateway, which caches what it
              fetches.
            </>
          }
        >
          <ServerRows />
        </SettingsSection>
      </div>
    </div>
  );
}

/**
 * The section index: a sticky row of tabs atop the page (the app sidebar
 * already takes the left), highlighting the section being read.
 */
function SectionTabs() {
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);
  const barRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // While a tab click scrolls the page, the sections it passes don't count.
  const pinnedUntil = useRef(0);

  useEffect(() => {
    const root = barRef.current?.closest(".ot-app-scroll") ?? null;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        if (Date.now() < pinnedUntil.current) return;
        const first = SECTIONS.find((sec) => visible.get(sec.id));
        if (first) setCurrent(first.id);
      },
      // A band just under the sticky bar: the section crossing it is "current".
      { root, rootMargin: "-72px 0px -60% 0px" },
    );
    for (const sec of SECTIONS) {
      const el = document.getElementById(sec.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  // Keep the highlighted tab in view on narrow screens. Scroll the tab row
  // itself: scrollIntoView would also "scroll" the page, which cancels a
  // smooth scroll a tab click has under way (the tabs then didn't move).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
    list.scrollTo({ left, behavior: "smooth" });
  }, [current]);

  const goTo = (id: string) => {
    const el = document.getElementById(id);
    const bar = barRef.current;
    const root = bar?.closest<HTMLElement>(".ot-app-scroll");
    if (!el || !bar) return;
    setCurrent(id);
    pinnedUntil.current = Date.now() + 1200;
    if (!root) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const top =
      el.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop -
      bar.offsetHeight -
      12;
    root.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  return (
    <nav
      ref={barRef}
      aria-label="Settings sections"
      className="sticky top-0 z-20 -mx-1 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-1 backdrop-blur"
    >
      <ul
        ref={listRef}
        className="ot-hide-scrollbar flex gap-1 overflow-x-auto py-2"
      >
        {SECTIONS.map((sec) => (
          <li key={sec.id} className="shrink-0">
            <a
              href={`#${sec.id}`}
              data-section={sec.id}
              aria-current={current === sec.id ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                goTo(sec.id);
              }}
              className={cn(
                "block rounded-full px-3 py-1.5 text-sm font-medium transition",
                current === sec.id
                  ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]",
              )}
            >
              {sec.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type RowProps = { s: AppSettings; set: (patch: SettingsPatch) => void };

function PlaybackSelects({ s, set }: RowProps) {
  const qualityId = useId();
  const captionsId = useId();
  return (
    <>
      <SettingRow
        title="Default quality"
        htmlFor={qualityId}
        description="720p and 360p start fastest; 1080p and up load video and audio separately."
      >
        <select
          id={qualityId}
          className={selectClassName}
          value={s.defaultPlaybackQuality}
          onChange={(e) =>
            set({
              defaultPlaybackQuality: e.currentTarget
                .value as DefaultPlaybackQuality,
            })
          }
        >
          {DEFAULT_PLAYBACK_QUALITY_SELECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        title="Subtitle language"
        htmlFor={captionsId}
        description="Used when subtitles are on; videos without it use their own language."
      >
        <select
          id={captionsId}
          className={selectClassName}
          value={s.captionLanguage}
          onChange={(e) => set({ captionLanguage: e.currentTarget.value })}
        >
          {captionLanguageOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
  );
}

function RegionRow({ s, set }: RowProps) {
  const id = useId();
  return (
    <SettingRow
      title="Region"
      htmlFor={id}
      description="For trending videos on Home and Explore."
    >
      <select
        id={id}
        className={cn(selectClassName, "w-56")}
        value={s.trendingRegion}
        onChange={(e) => set({ trendingRegion: e.currentTarget.value })}
      >
        {TRENDING_REGION_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

function FavoriteTagRow({
  value,
  onSave,
}: {
  value: string;
  onSave: (tag: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const tags = trpc.channelTags.listAll.useQuery();
  const commit = () => {
    const tag = draft.trim();
    if (tag && tag !== value) onSave(tag);
    else setDraft(value);
  };
  return (
    <SettingRow
      title="Favorite tag"
      htmlFor={id}
      description="The star on a channel adds this tag. Favorites shows the channels that have it."
    >
      <input
        id={id}
        list={`${id}-options`}
        className={cn(selectClassName, "w-40")}
        value={draft}
        maxLength={32}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <datalist id={`${id}-options`}>
        {(tags.data ?? []).map(({ tag }) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </SettingRow>
  );
}

function SwipeRow({ dir, s, set }: RowProps & { dir: "left" | "right" }) {
  const id = useId();
  return (
    <SettingRow
      title={dir === "left" ? "Swipe left" : "Swipe right"}
      htmlFor={id}
      disabled={!s.enableSwipeGestures}
    >
      <select
        id={id}
        className={selectClassName}
        disabled={!s.enableSwipeGestures}
        value={s.swipeGestures[dir]}
        onChange={(e) =>
          set({
            swipeGestures: {
              ...s.swipeGestures,
              [dir]: e.currentTarget.value as SwipeAction,
            },
          })
        }
      >
        {SWIPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

function QuickActionsRow({ s, set }: RowProps) {
  const isDefault =
    s.quickActions.join(",") === DEFAULT_QUICK_ACTIONS.join(",");
  return (
    <SettingRow
      stack
      title="Quick actions"
      description="Slots 1–2 are the hover buttons on thumbnails (desktop); all four are the buttons atop a video's menu on phones."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => (
          <label key={slot} className="space-y-1">
            <span className="block text-xs text-[hsl(var(--muted-foreground))]">
              Slot {slot + 1}
            </span>
            <select
              className={cn(selectClassName, "w-full")}
              value={s.quickActions[slot] ?? "none"}
              onChange={(e) =>
                set({
                  quickActions: assignQuickAction(
                    s.quickActions,
                    slot,
                    e.currentTarget.value as QuickAction | "none",
                  ),
                })
              }
            >
              <option value="none">None</option>
              {QUICK_ACTION_VALUES.map((a) => (
                <option key={a} value={a}>
                  {QUICK_ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {isDefault ? null : (
        <button
          type="button"
          className="mt-2 text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:text-[hsl(var(--foreground))] hover:underline"
          onClick={() => set({ quickActions: DEFAULT_QUICK_ACTIONS })}
        >
          Reset to Queue, Save, Like, Dislike
        </button>
      )}
    </SettingRow>
  );
}

function DataExportRows() {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<string | null>(null);
  const [importJson, setImportJson] = useState("");
  const [replace, setReplace] = useState(true);
  const exportQuery = trpc.settings.exportData.useQuery(undefined, {
    enabled: false,
  });
  const opmlQuery = trpc.subscriptions.exportOpml.useQuery(undefined, {
    enabled: false,
  });
  const importMutation = trpc.settings.importData.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
      setImportJson("");
      setMessage("Import finished.");
    },
    onError: (e) => setMessage(`Import failed: ${e.message}`),
  });

  async function onExport() {
    const data = await exportQuery.refetch();
    if (!data.data) return setMessage("Export failed.");
    await navigator.clipboard.writeText(JSON.stringify(data.data, null, 2));
    setMessage("Export copied to the clipboard.");
  }

  async function onExportOpml() {
    const data = await opmlQuery.refetch();
    if (!data.data) return setMessage("OPML export failed.");
    const url = URL.createObjectURL(
      new Blob([data.data.opml], { type: "text/xml" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "owntube-subscriptions.opml";
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`OPML exported (${data.data.count} subscriptions).`);
  }

  return (
    <>
      <SettingRow
        title="Export"
        description="Settings, history, likes and subscriptions as JSON (copied), or subscriptions as OPML."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exportQuery.isFetching}
          >
            Copy JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportOpml}
            disabled={opmlQuery.isFetching}
          >
            OPML
          </Button>
        </div>
      </SettingRow>
      <SettingRow
        stack
        title="Import OwnTube JSON"
        description="Paste an export from this or another OwnTube."
      >
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.currentTarget.value)}
          placeholder="Paste export JSON here"
          className="min-h-24 w-full rounded-[var(--radius-shell)] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 font-mono text-xs"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              importMutation.mutate({
                replaceExisting: replace,
                payloadJson: importJson,
              })
            }
            disabled={importMutation.isPending || !importJson.trim()}
          >
            Import
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.currentTarget.checked)}
            />
            Replace existing data
          </label>
        </div>
        {message ? (
          <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
            {message}
          </p>
        ) : null}
      </SettingRow>
    </>
  );
}

function ServerRows() {
  const utils = trpc.useUtils();
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const clearCaches = trpc.settings.clearCaches.useMutation({
    onSuccess: async (res) => {
      await Promise.all([
        utils.feed.home.invalidate(),
        utils.trending.list.invalidate(),
        utils.search.videos.invalidate(),
        utils.video.detail.invalidate(),
        utils.video.related.invalidate(),
        utils.channel.page.invalidate(),
      ]);
      setCacheMessage(`Cleared ${res.clearedRows} cached rows.`);
    },
    onError: (e) => setCacheMessage(`Clearing failed: ${e.message}`),
  });

  return (
    <>
      <SettingRow
        title="Cache"
        description={
          cacheMessage ??
          "Clear OwnTube's own caches (home feed, RSS, SponsorBlock) after big imports."
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCacheMessage(null);
            clearCaches.mutate();
          }}
          disabled={clearCaches.isPending}
        >
          {clearCaches.isPending ? "Clearing…" : "Clear cache"}
        </Button>
      </SettingRow>
    </>
  );
}
