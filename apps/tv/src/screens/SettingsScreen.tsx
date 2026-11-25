import type { DefaultPlaybackQuality } from "@web/lib/default-playback-quality";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import type { Section } from "@/components/Sidebar";
import {
  APP_VERSION,
  type AvailableUpdate,
  BUILD_ID,
  checkForUpdate,
  VERSION_CODE,
} from "@/lib/app-version";
import { getActiveProfile, type Profile } from "@/lib/auth-token";
import { baseUrl } from "@/lib/config";
import { errorMessage } from "@/lib/error-message";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import {
  createStyles,
  setUiSize,
  UI_SIZE_ADJUSTABLE,
  UI_SIZES,
  type UiSize,
  uiSize,
} from "@/lib/ui-scale";
import { HomeRowsSettingsScreen } from "@/screens/HomeRowsSettingsScreen";
import { SidebarSettingsScreen } from "@/screens/SidebarSettingsScreen";
import { colors, fontSize, radius, spacing } from "@/theme";

/** The subset worth exposing on a TV — the rest stays web-only. */
type TvSettings = {
  defaultPlaybackQuality: DefaultPlaybackQuality;
  autoplayNext: boolean;
  sponsorBlockEnabled: boolean;
  sponsorBlockAutoSkip: boolean;
  hideShortsInSubscriptions: boolean;
};

const QUALITIES: DefaultPlaybackQuality[] = [
  "best",
  "1080p",
  "720p",
  "480p",
  "360p",
];

/**
 * Playback preferences, shared with the web app rather than duplicated: the
 * player reads `defaultPlaybackQuality` and the SponsorBlock flags from here,
 * so changing them on either surface affects both.
 */
const UI_SIZE_LABELS: Record<UiSize, string> = {
  compact: "Compact",
  default: "Default",
  large: "Large",
};

export function SettingsScreen({
  onSidebarChange,
  onSignOut,
  onChangeServer,
  onSwitchProfile,
}: {
  /** Lets the shell re-render its rail as soon as the order changes. */
  onSidebarChange?: (order: Section[]) => void;
  onSignOut: () => void;
  /** Signs out and returns to the server screen. */
  onChangeServer: () => void;
  /** Who's watching: another profile, or add one. */
  onSwitchProfile: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    getActiveProfile().then(setProfile);
  }, []);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  useEffect(() => {
    checkForUpdate().then(setUpdate);
  }, []);
  const [page, setPage] = useState<"root" | "sidebar" | "homeRows">("root");
  const [settings, setSettings] = useState<TvSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stored = trpc.settings.get.useQuery();

  useEffect(() => {
    if (!stored.data) return;
    setSettings({
      defaultPlaybackQuality: stored.data.defaultPlaybackQuality,
      autoplayNext: stored.data.autoplayNext,
      sponsorBlockEnabled: stored.data.sponsorBlockEnabled,
      sponsorBlockAutoSkip: stored.data.sponsorBlockAutoSkip,
      hideShortsInSubscriptions: stored.data.hideShortsInSubscriptions,
    });
  }, [stored.data]);

  useEffect(() => {
    if (stored.error) setError(errorMessage(stored.error));
  }, [stored.error]);

  /** Optimistic: the control reflects the change, the server catches up. */
  const patch = (change: Partial<TvSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...change } : prev));
    trpcClient.settings.update
      .mutate(change)
      // Settings change what feeds return (hidden Shorts, region), so the
      // cached pages are no longer what the server would send.
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
        void queryClient.invalidateQueries({
          queryKey: [["settings", "get"]],
        });
      })
      .catch((err: unknown) => {
        setError(errorMessage(err));
      });
  };

  if (page === "sidebar") {
    return (
      <SidebarSettingsScreen
        onChange={onSidebarChange}
        onBack={() => setPage("root")}
      />
    );
  }
  if (page === "homeRows") {
    return <HomeRowsSettingsScreen onBack={() => setPage("root")} />;
  }

  if (error && !settings) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{error}</Text>
      </View>
    );
  }
  if (!settings) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.section}>Default quality</Text>
      <View style={styles.row}>
        {QUALITIES.map((q) => (
          <FocusButton
            key={q}
            label={q}
            onPress={() => patch({ defaultPlaybackQuality: q })}
            style={
              settings.defaultPlaybackQuality === q ? styles.active : undefined
            }
          />
        ))}
      </View>

      <Text style={styles.section}>Playback</Text>
      <View style={styles.row}>
        <Toggle
          label="Autoplay next"
          on={settings.autoplayNext}
          onPress={() => patch({ autoplayNext: !settings.autoplayNext })}
        />
        <Toggle
          label="Hide Shorts in subscriptions"
          on={settings.hideShortsInSubscriptions}
          onPress={() =>
            patch({
              hideShortsInSubscriptions: !settings.hideShortsInSubscriptions,
            })
          }
        />
      </View>

      <Text style={styles.section}>SponsorBlock</Text>
      <View style={styles.row}>
        <Toggle
          label="Enabled"
          on={settings.sponsorBlockEnabled}
          onPress={() =>
            patch({ sponsorBlockEnabled: !settings.sponsorBlockEnabled })
          }
        />
        <Toggle
          label="Auto-skip"
          on={settings.sponsorBlockAutoSkip}
          onPress={() =>
            patch({ sponsorBlockAutoSkip: !settings.sponsorBlockAutoSkip })
          }
        />
      </View>

      {UI_SIZE_ADJUSTABLE ? (
        <>
          <Text style={styles.section}>Text size</Text>
          <View style={styles.row}>
            {UI_SIZES.map((size) => (
              <FocusButton
                key={size}
                label={UI_SIZE_LABELS[size]}
                // Applies by reloading the app (see lib/ui-scale).
                onPress={() => void setUiSize(size)}
                style={size === uiSize ? styles.active : undefined}
              />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.section}>Layout</Text>
      <View style={styles.row}>
        <FocusButton label="Edit sidebar" onPress={() => setPage("sidebar")} />
        <FocusButton
          label="Edit home rows"
          onPress={() => setPage("homeRows")}
        />
      </View>

      <Text style={styles.section}>Account</Text>
      <View style={styles.row}>
        {profile ? <Text style={styles.value}>{profile.label}</Text> : null}
        <FocusButton label="Switch or add profile" onPress={onSwitchProfile} />
        <FocusButton label="Sign out" onPress={onSignOut} />
      </View>

      <Text style={styles.section}>Server</Text>
      <View style={styles.row}>
        <Text style={styles.value}>{baseUrl()}</Text>
        <FocusButton label="Change server" onPress={onChangeServer} />
      </View>

      <Text style={styles.section}>About</Text>
      <View style={styles.about}>
        <Text style={styles.aboutText}>
          OwnTube TV {APP_VERSION} ({VERSION_CODE})
          {BUILD_ID ? ` · build ${BUILD_ID.slice(0, 7)}` : ""}
        </Text>
        {update ? (
          <Text style={styles.update}>
            Update available: {update.version}. Install it from {update.apkUrl}{" "}
            (for example with the Downloader app).
            {update.notes ? `\n${update.notes}` : ""}
          </Text>
        ) : (
          <Text style={styles.muted}>Up to date.</Text>
        )}
      </View>

      {error ? <Text style={styles.muted}>{error}</Text> : null}
    </ScrollView>
  );
}

function Toggle({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <FocusButton
      label={`${label}: ${on ? "On" : "Off"}`}
      onPress={onPress}
      style={on ? styles.active : undefined}
    />
  );
}

const styles = createStyles({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
    marginBottom: spacing.lg,
  },
  section: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  // Opaque: it sits under the focus glow. See colors.surfaceStrongSolid.
  active: {
    backgroundColor: colors.brandSoftSolid,
    borderRadius: radius.shell,
  },
  sidebarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
  value: {
    color: colors.foreground,
    fontSize: fontSize.md,
    alignSelf: "center",
    marginRight: spacing.md,
  },
  about: { gap: spacing.xs, marginBottom: spacing.xl },
  aboutText: { color: colors.foreground, fontSize: fontSize.md },
  update: { color: colors.brand, fontSize: fontSize.md },
});
