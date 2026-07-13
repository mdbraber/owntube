"use client";

import { useEffect, useMemo, useState } from "react";
import { InstanceSourceHint } from "@/components/settings/instance-source-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type SponsorBlockCategory,
} from "@/lib/sponsorblock";
import {
  sponsorBlockPrefsFromAppSettings,
  toggleSponsorBlockCategory,
  writeSponsorBlockPrefs,
} from "@/lib/sponsorblock-prefs";
import { TRENDING_REGION_OPTIONS } from "@/lib/trending-regions";
import { writeWatchMiniEnabled } from "@/lib/watch-mini-player-state";
import type {
  InstanceSourceInfo,
  InstanceSourceRow,
} from "@/server/services/proxy";
import type { AppSettings } from "@/server/settings/profile";
import {
  type ThemeMode,
  useThemeStore,
  type VisualTheme,
} from "@/stores/theme-store";
import { trpc } from "@/trpc/react";

type SettingsPanelProps = {
  initial: AppSettings;
  initialInstanceSources: InstanceSourceInfo;
};

function nonEmptyUrls(urls: string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean);
}

type UpstreamInstanceListEditorProps = {
  label: string;
  source: InstanceSourceRow;
  urls: string[];
  preferredUrl: string;
  onUrlsChange: (urls: string[]) => void;
  onPreferredChange: (url: string) => void;
};

function UpstreamInstanceListEditor({
  label,
  source,
  urls,
  preferredUrl,
  onUrlsChange,
  onPreferredChange,
}: UpstreamInstanceListEditorProps) {
  const rows = urls.length > 0 ? urls : [""];

  function updateUrl(index: number, value: string) {
    const next = [...rows];
    next[index] = value;
    onUrlsChange(next);
  }

  function removeUrl(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onUrlsChange(next);
    if (preferredUrl === rows[index]) onPreferredChange(next[0] ?? "");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={urls.some((url) => !url.trim())}
          onClick={() => onUrlsChange([...urls, ""])}
        >
          Add instance
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((url, index) => {
          const trimmed = url.trim();
          const preferred = trimmed.length > 0 && preferredUrl === trimmed;
          return (
            <div key={`${label}-${trimmed || "empty"}`} className="flex gap-2">
              <Input
                value={url}
                placeholder={
                  source.envUrl ??
                  source.envRaw ??
                  "Leave empty to use server defaults"
                }
                onChange={(e) => updateUrl(index, e.currentTarget.value)}
              />
              <Button
                type="button"
                variant={preferred ? "default" : "outline"}
                size="sm"
                disabled={!trimmed}
                onClick={() => onPreferredChange(trimmed)}
              >
                Preferred
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removeUrl(index)}
              >
                Remove
              </Button>
            </div>
          );
        })}
      </div>
      <InstanceSourceHint row={source} />
    </div>
  );
}

export function SettingsPanel({
  initial,
  initialInstanceSources,
}: SettingsPanelProps) {
  const utils = trpc.useUtils();
  const setTheme = useThemeStore((s) => s.setTheme);
  const setVisualTheme = useThemeStore((s) => s.setVisualTheme);

  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    initialData: { ...initial, instanceSources: initialInstanceSources },
  });
  const instanceSources =
    settingsQuery.data?.instanceSources ?? initialInstanceSources;

  const [theme, setThemeLocal] = useState<ThemeMode>(initial.theme);
  const [visualTheme, setVisualThemeLocal] = useState<VisualTheme>(
    initial.visualTheme,
  );
  const [pipedBaseUrls, setPipedBaseUrls] = useState<string[]>(
    initial.pipedBaseUrls.length > 0
      ? initial.pipedBaseUrls
      : initial.pipedBaseUrl
        ? [initial.pipedBaseUrl]
        : [],
  );
  const [invidiousBaseUrls, setInvidiousBaseUrls] = useState<string[]>(
    initial.invidiousBaseUrls.length > 0
      ? initial.invidiousBaseUrls
      : initial.invidiousBaseUrl
        ? [initial.invidiousBaseUrl]
        : [],
  );
  const [preferredPipedBaseUrl, setPreferredPipedBaseUrl] = useState(
    initial.preferredPipedBaseUrl ?? initial.pipedBaseUrls[0] ?? "",
  );
  const [preferredInvidiousBaseUrl, setPreferredInvidiousBaseUrl] = useState(
    initial.preferredInvidiousBaseUrl ?? initial.invidiousBaseUrls[0] ?? "",
  );
  const [trendingRegion, setTrendingRegion] = useState(
    initial.trendingRegion ?? "US",
  );
  const [hideRestrictedVideos, setHideRestrictedVideos] = useState(
    initial.hideRestrictedVideos ?? true,
  );
  const [hideShortsInSubscriptions, setHideShortsInSubscriptions] = useState(
    initial.hideShortsInSubscriptions ?? true,
  );
  const [defaultCinemaMode, setDefaultCinemaMode] = useState(
    initial.defaultCinemaMode ?? false,
  );
  const [enableMiniPlayer, setEnableMiniPlayer] = useState(
    initial.enableMiniPlayer ?? true,
  );
  const [backgroundPlayback, setBackgroundPlayback] = useState(
    initial.backgroundPlayback ?? true,
  );
  const [autoplayOnWatch, setAutoplayOnWatch] = useState(
    initial.autoplayOnWatch ?? true,
  );
  const [defaultPlaybackQuality, setDefaultPlaybackQuality] =
    useState<DefaultPlaybackQuality>(initial.defaultPlaybackQuality ?? "1080p");
  const [enableSwipeGestures, setEnableSwipeGestures] = useState(
    initial.enableSwipeGestures ?? true,
  );
  const [swipeGestures, setSwipeGestures] = useState<
    Record<"left" | "right", "none" | "queue" | "saved" | "ignore" | "watched">
  >(
    initial.swipeGestures ?? {
      left: "ignore",
      right: "queue",
    },
  );
  const [quickActions, setQuickActions] = useState<QuickAction[]>(
    initial.quickActions ?? DEFAULT_QUICK_ACTIONS,
  );
  const initialSponsorPrefs = sponsorBlockPrefsFromAppSettings(initial);
  const [sponsorBlockEnabled, setSponsorBlockEnabled] = useState(
    initialSponsorPrefs.enabled,
  );
  const [sponsorBlockAutoSkip, setSponsorBlockAutoSkip] = useState(
    initialSponsorPrefs.autoSkip,
  );
  const [sponsorBlockCategories, setSponsorBlockCategories] = useState(
    initialSponsorPrefs.categories,
  );
  const [importJson, setImportJson] = useState("");
  const [importModeReplace, setImportModeReplace] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [healthMessage, setHealthMessage] = useState<string | null>(null);
  const [checkedInstanceSources, setCheckedInstanceSources] =
    useState<InstanceSourceInfo | null>(null);

  useEffect(() => {
    setTheme(initial.theme);
  }, [initial.theme, setTheme]);

  useEffect(() => {
    setVisualTheme(initial.visualTheme);
  }, [initial.visualTheme, setVisualTheme]);

  useEffect(() => {
    setTrendingRegion(initial.trendingRegion ?? "US");
  }, [initial.trendingRegion]);

  useEffect(() => {
    setHideRestrictedVideos(initial.hideRestrictedVideos ?? true);
  }, [initial.hideRestrictedVideos]);

  useEffect(() => {
    setHideShortsInSubscriptions(initial.hideShortsInSubscriptions ?? true);
  }, [initial.hideShortsInSubscriptions]);

  useEffect(() => {
    setDefaultCinemaMode(initial.defaultCinemaMode ?? false);
  }, [initial.defaultCinemaMode]);

  useEffect(() => {
    setEnableMiniPlayer(initial.enableMiniPlayer ?? true);
    writeWatchMiniEnabled(initial.enableMiniPlayer ?? true);
  }, [initial.enableMiniPlayer]);

  useEffect(() => {
    setBackgroundPlayback(initial.backgroundPlayback ?? true);
  }, [initial.backgroundPlayback]);

  useEffect(() => {
    setAutoplayOnWatch(initial.autoplayOnWatch ?? true);
  }, [initial.autoplayOnWatch]);

  useEffect(() => {
    const q = initial.defaultPlaybackQuality ?? "1080p";
    setDefaultPlaybackQuality(q);
    writeDefaultPlaybackQuality(q);
  }, [initial.defaultPlaybackQuality]);

  useEffect(() => {
    const prefs = sponsorBlockPrefsFromAppSettings(initial);
    setSponsorBlockEnabled(prefs.enabled);
    setSponsorBlockAutoSkip(prefs.autoSkip);
    setSponsorBlockCategories(prefs.categories);
    writeSponsorBlockPrefs(prefs);
  }, [initial]);

  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: async (data) => {
      setTheme(data.theme);
      setThemeLocal(data.theme);
      setVisualTheme(data.visualTheme);
      setVisualThemeLocal(data.visualTheme);
      setTrendingRegion(data.trendingRegion ?? "US");
      writeWatchMiniEnabled(data.enableMiniPlayer ?? true);
      writeDefaultPlaybackQuality(data.defaultPlaybackQuality ?? "1080p");
      writeSponsorBlockPrefs(sponsorBlockPrefsFromAppSettings(data));
      await utils.settings.get.invalidate();
      await utils.feed.home.invalidate();
      await utils.trending.list.invalidate();
      setMessage("Settings saved.");
    },
  });

  const exportQuery = trpc.settings.exportData.useQuery(undefined, {
    enabled: false,
  });

  const opmlQuery = trpc.subscriptions.exportOpml.useQuery(undefined, {
    enabled: false,
  });

  const importMutation = trpc.settings.importData.useMutation({
    onSuccess: async () => {
      await utils.settings.get.invalidate();
      setMessage("Import finished.");
    },
  });

  const clearCachesMutation = trpc.settings.clearCaches.useMutation({
    onSuccess: async (res) => {
      await Promise.all([
        utils.feed.home.invalidate(),
        utils.trending.list.invalidate(),
        utils.search.videos.invalidate(),
        utils.video.detail.invalidate(),
        utils.video.related.invalidate(),
        utils.channel.page.invalidate(),
      ]);
      setMessage(`Cache cleared (${res.clearedRows} cached rows removed).`);
    },
    onError: (e) => {
      setMessage(`Cache clear failed: ${e.message}`);
    },
  });

  const exporting = exportQuery.isFetching;
  const saving = updateMutation.isPending;
  const importing = importMutation.isPending;
  const clearingCaches = clearCachesMutation.isPending;
  const healthCheckInput = useMemo(
    () => ({
      pipedBaseUrls: nonEmptyUrls(pipedBaseUrls),
      invidiousBaseUrls: nonEmptyUrls(invidiousBaseUrls),
      preferredPipedBaseUrl: preferredPipedBaseUrl.trim() || undefined,
      preferredInvidiousBaseUrl: preferredInvidiousBaseUrl.trim() || undefined,
    }),
    [
      pipedBaseUrls,
      invidiousBaseUrls,
      preferredPipedBaseUrl,
      preferredInvidiousBaseUrl,
    ],
  );
  const healthQuery = trpc.settings.checkInstances.useQuery(healthCheckInput, {
    enabled: false,
  });

  const appearanceButtons = useMemo(
    () =>
      (["system", "light", "dark"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          variant={theme === value ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setThemeLocal(value);
            setTheme(value);
          }}
        >
          {value === "system" ? "System" : value === "light" ? "Light" : "Dark"}
        </Button>
      )),
    [setTheme, theme],
  );

  const visualThemeButtons = useMemo(
    () =>
      (["default", "terminal"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          variant={visualTheme === value ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setVisualThemeLocal(value);
            setVisualTheme(value);
          }}
        >
          {value === "default" ? "Default" : "Terminal"}
        </Button>
      )),
    [setVisualTheme, visualTheme],
  );

  async function onSave() {
    setMessage(null);
    const nextPipedBaseUrls = nonEmptyUrls(pipedBaseUrls);
    const nextInvidiousBaseUrls = nonEmptyUrls(invidiousBaseUrls);
    await updateMutation.mutateAsync({
      theme,
      visualTheme,
      pipedBaseUrls: nextPipedBaseUrls,
      invidiousBaseUrls: nextInvidiousBaseUrls,
      preferredPipedBaseUrl: nextPipedBaseUrls.includes(
        preferredPipedBaseUrl.trim(),
      )
        ? preferredPipedBaseUrl.trim()
        : nextPipedBaseUrls[0],
      preferredInvidiousBaseUrl: nextInvidiousBaseUrls.includes(
        preferredInvidiousBaseUrl.trim(),
      )
        ? preferredInvidiousBaseUrl.trim()
        : nextInvidiousBaseUrls[0],
      trendingRegion,
      hideRestrictedVideos,
      hideShortsInSubscriptions,
      defaultCinemaMode,
      enableMiniPlayer,
      backgroundPlayback,
      autoplayOnWatch,
      defaultPlaybackQuality,
      sponsorBlockEnabled,
      sponsorBlockAutoSkip,
      sponsorBlockCategories,
      enableSwipeGestures,
      swipeGestures,
      quickActions,
    });
  }

  function onSponsorCategoryToggle(category: SponsorBlockCategory) {
    setSponsorBlockCategories((prev) =>
      toggleSponsorBlockCategory(prev, category),
    );
  }

  async function onExport() {
    setMessage(null);
    const data = await exportQuery.refetch();
    if (!data.data) {
      setMessage("Export failed.");
      return;
    }
    const text = JSON.stringify(data.data, null, 2);
    await navigator.clipboard.writeText(text);
    setMessage("Export copied to clipboard.");
  }

  async function onImport() {
    setMessage(null);
    await importMutation.mutateAsync({
      replaceExisting: importModeReplace,
      payloadJson: importJson,
    });
  }

  async function onExportOpml() {
    setMessage(null);
    const data = await opmlQuery.refetch();
    if (!data.data) {
      setMessage("OPML export failed.");
      return;
    }
    const blob = new Blob([data.data.opml], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "owntube-subscriptions.opml";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`OPML exported (${data.data.count} subscriptions).`);
  }

  async function onCheckInstances() {
    setHealthMessage(null);
    const data = await healthQuery.refetch();
    if (!data.data) {
      setHealthMessage("Health check failed.");
      return;
    }
    setCheckedInstanceSources(data.data.instanceSources);
    const p =
      data.data.pipedOk == null
        ? "Piped: not set"
        : `Piped: ${data.data.pipedOk ? "healthy" : "down"}`;
    const i =
      data.data.invidiousOk == null
        ? "Invidious: not set"
        : `Invidious: ${data.data.invidiousOk ? "healthy" : "down"}`;
    setHealthMessage(`${p} · ${i}`);
  }

  const displayedInstanceSources = checkedInstanceSources ?? instanceSources;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Theme</h2>
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Appearance</p>
            <div className="flex flex-wrap gap-2">{appearanceButtons}</div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Style</p>
            <div className="flex flex-wrap gap-2">{visualThemeButtons}</div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Home / trending region</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Used for the trending slice of your feed and the Explore page when no{" "}
          <code className="rounded bg-[hsl(var(--muted))] px-1 font-mono text-xs">
            ?region=
          </code>{" "}
          query is set.
        </p>
        <div className="max-w-md space-y-1">
          <label
            htmlFor="settings-trending-region"
            className="text-sm font-medium"
          >
            Region (ISO code)
          </label>
          <select
            id="settings-trending-region"
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
            value={trendingRegion}
            onChange={(e) => setTrendingRegion(e.target.value)}
          >
            {TRENDING_REGION_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label} ({o.code})
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Video source instances</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Optional per-account override. Leave blank to use the server{" "}
          <code className="rounded bg-[hsl(var(--muted))] px-1 font-mono text-xs">
            .env
          </code>{" "}
          values shown below.
        </p>
        <div className="space-y-4 max-w-2xl">
          <UpstreamInstanceListEditor
            label="Piped instances"
            source={displayedInstanceSources.piped}
            urls={pipedBaseUrls}
            preferredUrl={preferredPipedBaseUrl}
            onUrlsChange={setPipedBaseUrls}
            onPreferredChange={setPreferredPipedBaseUrl}
          />
          <UpstreamInstanceListEditor
            label="Invidious instances"
            source={displayedInstanceSources.invidious}
            urls={invidiousBaseUrls}
            preferredUrl={preferredInvidiousBaseUrl}
            onUrlsChange={setInvidiousBaseUrls}
            onPreferredChange={setPreferredInvidiousBaseUrl}
          />
          <Button type="button" onClick={onSave} disabled={saving}>
            Save settings
          </Button>
          <Button type="button" variant="outline" onClick={onCheckInstances}>
            Check instances health
          </Button>
          {healthMessage ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {healthMessage}
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Watch and feed behavior</h2>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideRestrictedVideos}
              onChange={(e) => setHideRestrictedVideos(e.currentTarget.checked)}
            />
            Hide members-only / subscribers-only videos in feeds
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideShortsInSubscriptions}
              onChange={(e) =>
                setHideShortsInSubscriptions(e.currentTarget.checked)
              }
            />
            Hide Shorts from the Subscriptions feed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enableSwipeGestures}
              onChange={(e) => setEnableSwipeGestures(e.currentTarget.checked)}
            />
            Enable swipe gestures on Home / Explore / Subscriptions cards
            (mobile)
          </label>
          {enableSwipeGestures ? (
            <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
              {(
                [
                  ["left", "Swipe left"],
                  ["right", "Swipe right"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-[hsl(var(--muted-foreground))]">
                    {label}
                  </span>
                  <select
                    className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                    value={swipeGestures[key]}
                    onChange={(e) =>
                      setSwipeGestures((g) => ({
                        ...g,
                        [key]: e.currentTarget.value as
                          | "none"
                          | "queue"
                          | "saved"
                          | "ignore"
                          | "watched",
                      }))
                    }
                  >
                    <option value="none">None</option>
                    <option value="queue">Queue</option>
                    <option value="saved">Save</option>
                    <option value="ignore">Ignore</option>
                    <option value="watched">Mark watched</option>
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm">Quick actions</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              The first three appear as hover buttons on video thumbnails
              (desktop); all four as the button row in the mobile action sheet.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((slot) => (
                <label
                  key={slot}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-[hsl(var(--muted-foreground))]">
                    {slot < 2
                      ? `Slot ${slot + 1} (thumbnail)`
                      : `Slot ${slot + 1}`}
                  </span>
                  <select
                    className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                    value={quickActions[slot] ?? "none"}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setQuickActions((prev) => {
                        const next = prev.slice(0, 4);
                        if (value === "none") {
                          return next.filter((_, i) => i !== slot);
                        }
                        const action = value as QuickAction;
                        // One slot per verb: drop it elsewhere first.
                        const cleaned = next.filter(
                          (a, i) => i === slot || a !== action,
                        );
                        const idx = Math.min(slot, cleaned.length);
                        if (cleaned[slot] !== undefined && idx === slot) {
                          cleaned[slot] = action;
                        } else {
                          cleaned.splice(idx, 0, action);
                        }
                        return cleaned.slice(0, 4);
                      });
                    }}
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
            <button
              type="button"
              className="text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline"
              onClick={() => setQuickActions(DEFAULT_QUICK_ACTIONS)}
            >
              Reset to default (Queue, Save, Like, Dislike)
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={defaultCinemaMode}
              onChange={(e) => setDefaultCinemaMode(e.currentTarget.checked)}
            />
            Enable cinema mode by default on watch pages
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enableMiniPlayer}
              onChange={(e) => setEnableMiniPlayer(e.currentTarget.checked)}
            />
            Keep mini-player when leaving watch page
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={backgroundPlayback}
              onChange={(e) => setBackgroundPlayback(e.currentTarget.checked)}
            />
            Keep playing when you switch apps (iPhone/iPad: audio continues in
            the background)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoplayOnWatch}
              onChange={(e) => setAutoplayOnWatch(e.currentTarget.checked)}
            />
            Autoplay videos when opening the watch page
          </label>
          <div className="max-w-md space-y-1 pt-1">
            <label
              htmlFor="settings-default-playback-quality"
              className="text-sm font-medium"
            >
              Default playback quality
            </label>
            <select
              id="settings-default-playback-quality"
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              value={defaultPlaybackQuality}
              onChange={(e) =>
                setDefaultPlaybackQuality(
                  e.currentTarget.value as DefaultPlaybackQuality,
                )
              }
            >
              {DEFAULT_PLAYBACK_QUALITY_SELECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Used when a video opens. 720p or 360p muxed start faster; 1080p
              uses separate video and audio streams (slower start, more
              sensitive at 2× speed).
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">SponsorBlock</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Community-submitted segments (sponsors, intros, outros) from{" "}
          <a
            href="https://sponsor.ajay.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[hsl(var(--primary))] hover:underline"
          >
            SponsorBlock
          </a>
          . Shown on the watch player timeline; optional auto-skip.
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sponsorBlockEnabled}
              onChange={(e) => setSponsorBlockEnabled(e.currentTarget.checked)}
            />
            Enable SponsorBlock segments
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sponsorBlockAutoSkip}
              disabled={!sponsorBlockEnabled}
              onChange={(e) => setSponsorBlockAutoSkip(e.currentTarget.checked)}
            />
            Auto-skip segments during playback
          </label>
        </div>
        <fieldset className="space-y-2" disabled={!sponsorBlockEnabled}>
          <legend className="text-sm font-medium">Categories</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SPONSORBLOCK_ALL_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sponsorBlockCategories.includes(category)}
                  onChange={() => onSponsorCategoryToggle(category)}
                />
                {SPONSORBLOCK_CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cache maintenance</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Force-clear server-side caches after major imports or upstream issues.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setMessage(null);
            clearCachesMutation.mutate();
          }}
          disabled={clearingCaches}
        >
          {clearingCaches ? "Clearing cache…" : "Clear cache"}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Data export / import</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onExport}
            disabled={exporting}
          >
            Export (copy JSON)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onExportOpml}
            disabled={opmlQuery.isFetching}
          >
            Export subscriptions (OPML)
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={importModeReplace}
              onChange={(e) => setImportModeReplace(e.currentTarget.checked)}
            />
            Replace existing data
          </label>
        </div>
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.currentTarget.value)}
          placeholder="Paste export JSON here"
          className="min-h-48 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm"
        />
        <Button
          type="button"
          onClick={onImport}
          disabled={importing || !importJson.trim()}
        >
          Import JSON
        </Button>
      </section>

      {message ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
      ) : null}
    </div>
  );
}
