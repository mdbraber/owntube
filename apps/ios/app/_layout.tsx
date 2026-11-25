import { NativeTabs } from "expo-router/native-tabs";
import { ACCENT } from "@/lib/theme";
import { useIncomingLinks } from "@/lib/use-incoming-links";

/**
 * The app's root: a native tab bar (Liquid Glass on iOS 26+), each tab with
 * its own navigation stack. Search is the system search tab.
 */
export default function RootLayout() {
  useIncomingLinks();
  return (
    <NativeTabs minimizeBehavior="never" tintColor={ACCENT}>
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
