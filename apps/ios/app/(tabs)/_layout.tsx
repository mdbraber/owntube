import { useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect } from "react";
import { setCurrentTab } from "@/lib/current-tab";
import { ACCENT } from "@/lib/theme";
import { MiniPlayer } from "@/player/mini-player";
import { useNowPlaying } from "@/player/store";

/**
 * The tabs: a native tab bar (Liquid Glass on iOS 26+), each tab with
 * its own navigation stack. Search is the system search tab. While something
 * plays, the mini player sits above the tab bar (its bottom accessory).
 */
export default function TabsLayout() {
  const nowPlaying = useNowPlaying();
  const segments = useSegments() as string[];
  useEffect(() => {
    if (segments[0] === "(tabs)") setCurrentTab(segments[1]);
  }, [segments]);
  return (
    <NativeTabs minimizeBehavior="never" tintColor={ACCENT}>
      {nowPlaying ? (
        <NativeTabs.BottomAccessory>
          <MiniPlayer />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
        />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="subscriptions">
        <NativeTabs.Trigger.Icon
          sf={{
            default: "play.square.stack",
            selected: "play.square.stack.fill",
          }}
        />
        <NativeTabs.Trigger.Label>Subscriptions</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Icon
          sf={{ default: "books.vertical", selected: "books.vertical.fill" }}
        />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* biome-ignore lint/a11y/useSemanticElements: a native tab role, not ARIA */}
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
