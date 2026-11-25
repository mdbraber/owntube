import Constants from "expo-constants";

/**
 * The OwnTube server the app opens: `EXPO_PUBLIC_OWNTUBE_URL` (from `.env` at
 * build time). The address is configuration, never code.
 */
export const SERVER_URL = (
  process.env.EXPO_PUBLIC_OWNTUBE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export const SERVER_ORIGIN = new URL(SERVER_URL).origin;

/** The app's full URL for a web path (`/watch?v=…`). */
export function webUrl(path: string): string {
  return `${SERVER_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Appended to the WebView's user agent. The web app recognises it
 * (`apps/web/src/lib/native-app.ts`) and leaves out the chrome the app draws
 * natively: its top bar, sidebar and bottom tab bar.
 */
export const USER_AGENT_TOKEN = `OwnTubeApp/${Constants.expoConfig?.version ?? "0"}`;
