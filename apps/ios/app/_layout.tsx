import { Stack } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useIncomingLinks } from "@/lib/use-incoming-links";
import { flushProgress } from "@/player/store";

/**
 * The tabs, with the video player presented over them as a sheet (swipe down
 * to close; playback goes on in the mini player).
 */
export default function RootLayout() {
  useIncomingLinks();

  useEffect(() => {
    // iOS may end the app any time after it leaves the foreground.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") flushProgress();
    });
    return () => subscription.remove();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="player"
        options={{
          presentation: "modal",
          contentStyle: { backgroundColor: "#000" },
        }}
      />
    </Stack>
  );
}
