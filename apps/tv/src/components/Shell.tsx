import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { RAIL_WIDTH, type Section, Sidebar } from "@/components/Sidebar";
import type { Nav } from "@/lib/navigation";
import { ChannelScreen } from "@/screens/ChannelScreen";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { QueueScreen } from "@/screens/QueueScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { SubscriptionsScreen } from "@/screens/SubscriptionsScreen";
import { WatchScreen } from "@/screens/WatchScreen";
import { colors, spacing } from "@/theme";

/**
 * 10-foot app shell: a left nav over section screens, plus a small route stack
 * for watch/channel overlays. No navigation library — a section is the base and
 * watch/channel push onto a stack that remote Back pops (exits at the root).
 */
type Route =
  | { name: "watch"; videoId: string; resumeSeconds?: number }
  | { name: "channel"; channelId: string };

export function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [section, setSection] = useState<Section>("home");
  const [stack, setStack] = useState<Route[]>([]);
  const top = stack[stack.length - 1];

  const nav: Nav = useMemo(
    () => ({
      openVideo: (videoId, resumeSeconds) =>
        setStack((s) => [...s, { name: "watch", videoId, resumeSeconds }]),
      openChannel: (channelId) =>
        setStack((s) => [...s, { name: "channel", channelId }]),
    }),
    [],
  );

  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  // Remote Back pops the overlay stack first; at the shell root it exits.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 0) {
        pop();
        return true;
      }
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  if (top?.name === "watch") {
    return (
      <WatchScreen
        videoId={top.videoId}
        resumeSeconds={top.resumeSeconds}
        onOpenVideo={nav.openVideo}
        onOpenChannel={nav.openChannel}
        onBack={pop}
      />
    );
  }
  const body =
    top?.name === "channel" ? (
      <ChannelScreen channelId={top.channelId} nav={nav} />
    ) : section === "home" ? (
      <HomeScreen nav={nav} />
    ) : section === "search" ? (
      <SearchScreen nav={nav} />
    ) : section === "subscriptions" ? (
      <SubscriptionsScreen nav={nav} />
    ) : section === "queue" ? (
      <QueueScreen nav={nav} />
    ) : (
      <HistoryScreen nav={nav} />
    );

  // Content reserves the collapsed rail as a left margin; the sidebar overlays
  // the content (absolute) and expands rightward over it when focused.
  return (
    <View style={styles.shell}>
      <View style={styles.content}>{body}</View>
      <Sidebar active={section} onSelect={setSection} onSignOut={onSignOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1,
    marginLeft: RAIL_WIDTH,
    paddingVertical: spacing.screen,
    paddingRight: spacing.screen,
    paddingLeft: spacing.lg,
  },
});
