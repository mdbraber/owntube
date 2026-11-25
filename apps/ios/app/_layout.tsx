import { Stack } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuickActions } from "@/lib/home-screen-actions";
import { flushProgress } from "@/player/store";

/**
 * The tabs, with the video player presented over them as a sheet (swipe down
 * to close; playback goes on in the mini player).
 */
/** A link straight to the player still has the tabs beneath it. */
export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  useQuickActions();

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
