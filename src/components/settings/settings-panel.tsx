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
import type { InstanceSourceInfo } from "@/server/services/proxy";
import type { AppSettings } from "@/server/settings/profile";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";
import { trpc } from "@/trpc/react";

type SettingsPanelProps = {
  initial: AppSettings;
  initialInstanceSources: InstanceSourceInfo;
};

export function SettingsPanel({
  initial,
  initialInstanceSources,
}: SettingsPanelProps) {
  const utils = trpc.useUtils();
  const setTheme = useThemeStore((s) => s.setTheme);

  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    initialData: { ...initial, instanceSources: initialInstanceSources },
  });
  const instanceSources =
    settingsQuery.data?.instanceSources ?? initialInstanceSources;

  const [theme, setThemeLocal] = useState<ThemeMode>(initial.theme);
  const [pipedBaseUrl, setPipedBaseUrl] = useState(initial.pipedBaseUrl ?? "");
  const [invidiousBaseUrl, setInvidiousBaseUrl] = useState(
    initial.invidiousBaseUrl ?? "",
  );
  const [trendingRegion, setTrendingRegion] = useState(
    initial.trendingRegion ?? "US",
  );
  const [hideRestrictedVideos, setHideRestrictedVideos] = useState(
    initial.hideRestrictedVideos ?? true,
  );
  const [defaultCinemaMode, setDefaultCinemaMode] = useState(
    initial.defaultCinemaMode ?? false,
  );
  const [enableMiniPlayer, setEnableMiniPlayer] = useState(
    initial.enableMiniPlayer ?? true,
  );
  const [defaultPlaybackQuality, setDefaultPlaybackQuality] =
    useState<DefaultPlaybackQuality>(initial.defaultPlaybackQuality ?? "1080p");
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

  useEffect(() => {
    setTheme(initial.theme);
  }, [initial.theme, setTheme]);

  useEffect(() => {
    setTrendingRegion(initial.trendingRegion ?? "US");
  }, [initial.trendingRegion]);

  useEffect(() => {
    setHideRestrictedVideos(initial.hideRestrictedVideos ?? true);
  }, [initial.hideRestrictedVideos]);

  useEffect(() => {
    setDefaultCinemaMode(initial.defaultCinemaMode ?? false);
  }, [initial.defaultCinemaMode]);

  useEffect(() => {
    setEnableMiniPlayer(initial.enableMiniPlayer ?? true);
    writeWatchMiniEnabled(initial.enableMiniPlayer ?? true);
  }, [initial.enableMiniPlayer]);

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
  const healthQuery = trpc.settings.checkInstances.useQuery(undefined, {
    enabled: false,
  });

  const themeButtons = useMemo(
    () =>
      (["system", "light", "dark"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          variant={theme === value ? "default" : "outline"}
          size="sm"
          onClick={() => setThemeLocal(value)}
        >
          {value}
        </Button>
      )),
    [theme],
  );

  async function onSave() {
    setMessage(null);
    await updateMutation.mutateAsync({
      theme,
      pipedBaseUrl: pipedBaseUrl.trim() || undefined,
      invidiousBaseUrl: invidiousBaseUrl.trim() || undefined,
      trendingRegion,
      hideRestrictedVideos,
      defaultCinemaMode,
      enableMiniPlayer,
      defaultPlaybackQuality,
      sponsorBlockEnabled,
      sponsorBlockAutoSkip,
      sponsorBlockCategories,
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

  async function onCheckInstances() {
    setHealthMessage(null);
    const data = await healthQuery.refetch();
    if (!data.data) {
      setHealthMessage("Health check failed.");
      return;
    }
    const p =
      data.data.pipedOk == null
        ? "Piped: not set"
        : `Piped: ${data.data.pipedOk ? "ok" : "down"}`;
    const i =
      data.data.invidiousOk == null
        ? "Invidious: not set"
        : `Invidious: ${data.data.invidiousOk ? "ok" : "down"}`;
    setHealthMessage(`${p} · ${i}`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Theme</h2>
        <div className="flex flex-wrap gap-2">{themeButtons}</div>
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
          <div className="space-y-2">
            <label htmlFor="settings-piped" className="text-sm font-medium">
              Piped base URL (override)
            </label>
            <Input
              id="settings-piped"
              value={pipedBaseUrl}
              placeholder={
                instanceSources.piped.envUrl ??
                instanceSources.piped.envRaw ??
                "Leave empty to use server default"
              }
              onChange={(e) => setPipedBaseUrl(e.currentTarget.value)}
            />
            <InstanceSourceHint row={instanceSources.piped} />
          </div>
          <div className="space-y-2">
            <label htmlFor="settings-invidious" className="text-sm font-medium">
              Invidious base URL (override)
            </label>
            <Input
              id="settings-invidious"
              value={invidiousBaseUrl}
              placeholder={
                instanceSources.invidious.envUrl ??
                instanceSources.invidious.envRaw ??
                "Leave empty to use server default"
              }
              onChange={(e) => setInvidiousBaseUrl(e.currentTarget.value)}
            />
            <InstanceSourceHint row={instanceSources.invidious} />
          </div>
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
              Used when a video opens. 360p muxed starts faster on Piped; 1080p
              uses separate video and audio streams.
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
          {clearingCaches ? "Clearing cache..." : "Clear cache"}
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
