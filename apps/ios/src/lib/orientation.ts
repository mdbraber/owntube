import * as ScreenOrientation from "expo-screen-orientation";
import { Platform } from "react-native";

/**
 * iPhone, as YouTube's app: browsing stays portrait, and only the player
 * panel turns with the phone (into a full-screen video). iPad turns freely.
 */
export const isPhone = Platform.OS === "ios" && !Platform.isPad;

/** Portrait for browsing (iPhone). */
export function lockToPortrait() {
  if (!isPhone) return;
  void ScreenOrientation.lockAsync(
    ScreenOrientation.OrientationLock.PORTRAIT_UP,
  ).catch(() => {});
}

/** Let the player panel turn with the phone. */
export function allowRotation() {
  if (!isPhone) return;
  void ScreenOrientation.unlockAsync().catch(() => {});
}
