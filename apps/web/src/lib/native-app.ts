/**
 * The iOS app (apps/ios) shows these pages in its own native shell: tab bar,
 * navigation bar, menus and settings are drawn by iOS, and the pages fill the
 * space in between. It identifies itself with a token in the user agent, so
 * the server can leave the web chrome out of the very first render.
 *
 * Pure: no React or Next.js imports, so the iOS app imports the message types
 * from here too (`@web/lib/native-app`) and the two sides cannot drift apart.
 */

/** The user agent token the iOS app's WebView appends: `OwnTubeApp/<version>`. */
export const NATIVE_APP_UA_TOKEN = "OwnTubeApp/";

export function isNativeAppUserAgent(
  userAgent: string | null | undefined,
): boolean {
  return Boolean(userAgent?.includes(NATIVE_APP_UA_TOKEN));
}

/** Messages a page sends to the native shell. */
export type NativeAppMessage =
  /** The page changed (client-side navigations included): its title and URL. */
  | { type: "page"; title: string; url: string }
  /** The watch queue, as stored in localStorage["ot:watch-queue"], for the widget. */
  | { type: "queue"; raw: string };

type NativeWebViewWindow = {
  ReactNativeWebView?: { postMessage(message: string): void };
};

/** Sends a message to the native shell; false when not running inside it. */
export function postToNativeApp(message: NativeAppMessage): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as NativeWebViewWindow).ReactNativeWebView;
  if (!bridge) return false;
  bridge.postMessage(JSON.stringify(message));
  return true;
}

/** Parses a message from a page; null for anything that isn't one. */
export function parseNativeAppMessage(raw: string): NativeAppMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.type === "page" &&
    typeof message.title === "string" &&
    typeof message.url === "string"
  ) {
    return { type: "page", title: message.title, url: message.url };
  }
  if (message.type === "queue" && typeof message.raw === "string") {
    return { type: "queue", raw: message.raw };
  }
  return null;
}
