import { reloadAppAsync } from "expo";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const SERVER_KEY = "owntube.server-url";

/** The build's own server: `EXPO_PUBLIC_OWNTUBE_URL` (from `.env`). */
export const BUILT_IN_URL = (
  process.env.EXPO_PUBLIC_OWNTUBE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

function storedServerUrl(): string | null {
  try {
    return SecureStore.getItem(SERVER_KEY);
  } catch {
    return null;
  }
}

/**
 * The OwnTube server the app opens: the one chosen in Settings, else the
 * build's. Read once at launch; changing it reloads the app (`changeServer`),
 * so everything (pages, API, player) moves over together.
 */
export const SERVER_URL = storedServerUrl() ?? BUILT_IN_URL;

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

/**
 * What the user typed, as an origin: adds https:// when no scheme is given
 * and drops any path ("owntube.example.org/watch?v=x" → the site root).
 * The same rule as the TV app's server screen.
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Whether an OwnTube server answers at `url`: its public `auth.session`
 * procedure returns tRPC JSON. Anything else (a proxy's empty 200, an HTML
 * error page) means it isn't one, or isn't reachable.
 */
export async function checkServer(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/trpc/auth.session`);
    if (!response.ok) return false;
    const body = (await response.json()) as { result?: unknown };
    return body.result !== undefined;
  } catch {
    return false;
  }
}

/**
 * Switches to another server (null: back to the build's) and reloads the app.
 * The app's session belongs to the old server, so `forgetSession` drops it.
 */
export async function changeServer(
  url: string | null,
  forgetSession: () => Promise<void>,
): Promise<void> {
  if (url && url !== BUILT_IN_URL) {
    await SecureStore.setItemAsync(SERVER_KEY, url);
  } else {
    await SecureStore.deleteItemAsync(SERVER_KEY).catch(() => {});
  }
  await forgetSession();
  await reloadAppAsync();
}
