import { requireOptionalNativeModule } from "expo-modules-core";

type WidgetBridgeModule = {
  setWatchQueue(raw: string): boolean;
};

// Optional so a JS-only run (or a build without the module) degrades to a
// widget that doesn't update rather than a crash.
const native = requireOptionalNativeModule<WidgetBridgeModule>("WidgetBridge");

/** Hands the web app's watch queue (raw JSON) to the home-screen widget. */
export function setWatchQueue(raw: string): void {
  native?.setWatchQueue(raw);
}
