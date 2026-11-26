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

/** A video for the native player, as the watch page knows it. */
export type NativePlayRequest = {
  videoId: string;
  title: string;
  channelName?: string;
  poster?: string;
  /** Where to start: the link's `t`, or the saved resume position. */
  startSeconds?: number;
  durationSeconds?: number;
  isLive?: boolean;
  /** Start playing at once (the "Autoplay on watch" setting). */
  autoplay: boolean;
};

/** Messages a page sends to the native shell. */
export type NativeAppMessage =
  /** The page changed (client-side navigations included): its title and URL. */
  | { type: "page"; title: string; url: string }
  /** The watch queue, as stored in localStorage["ot:watch-queue"], for the widget. */
  | { type: "queue"; raw: string }
  /** Play a video in the native player (the watch page, inside the app). */
  | { type: "play"; video: NativePlayRequest }
  /** Who is signed in to the web app (null: nobody), so the app's own API
   *  session can follow it. */
  | { type: "session"; userId: number | null }
  /** The answer to an `approvePairing` command. */
  | { type: "pairingApproved"; userCode: string; ok: boolean }
  /**
   * The user went to another page (`isNewNativePage`): the app shows it as a
   * new screen on its navigation stack, so Back returns here.
   */
  | { type: "navigate"; url: string };

/** Commands the native shell sends to a page. */
export type NativeAppCommand =
  /**
   * Approve a device pairing the app started, with the page's sign-in: how the
   * app gets its own API token (the TV's pairing flow, without the QR code).
   */
  { type: "approvePairing"; userCode: string };

/**
 * Pages whose query string names the thing shown, so a different value is a
 * different page (another video, another playlist). Elsewhere the query only
 * filters or sorts what the page shows, which stays on the same screen.
 */
const IDENTITY_PARAMS: Record<string, string> = {
  "/watch": "v",
  "/playlist": "list",
};

/** Pages that move on by themselves (signing in, onboarding): no Back there. */
const PASS_THROUGH = /^\/(login|register|onboarding)(\/|$)/;

/**
 * Whether going from `from` to `to` should open a new screen in the app,
 * rather than change the current one in place. A new screen per page is how
 * iOS apps navigate: Back (or the edge swipe) returns to the previous page
 * as it was. Filters, sorting, tabs and a new search keep their screen.
 */
export function isNewNativePage(from: string, to: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(from);
    b = new URL(to, a);
  } catch {
    return false;
  }
  if (a.origin !== b.origin) return false;
  if (PASS_THROUGH.test(a.pathname)) return false;
  const path = (url: URL) => url.pathname.replace(/\/+$/, "") || "/";
  if (path(a) !== path(b)) return true;
  const identity = IDENTITY_PARAMS[path(b)];
  return Boolean(
    identity && a.searchParams.get(identity) !== b.searchParams.get(identity),
  );
}

/** The window event that carries a `NativeAppCommand` to the page. */
export const NATIVE_APP_COMMAND_EVENT = "ot:native-command";

/** Script the shell injects to deliver a command to the page. */
export function nativeAppCommandScript(command: NativeAppCommand): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(
    NATIVE_APP_COMMAND_EVENT,
  )}, { detail: ${JSON.stringify(command)} })); true;`;
}

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
  if (message.type === "play") {
    const video = parsePlayRequest(message.video);
    return video ? { type: "play", video } : null;
  }
  if (
    message.type === "session" &&
    (message.userId === null || typeof message.userId === "number")
  ) {
    return { type: "session", userId: message.userId };
  }
  if (message.type === "navigate" && typeof message.url === "string") {
    return { type: "navigate", url: message.url };
  }
  if (
    message.type === "pairingApproved" &&
    typeof message.userCode === "string" &&
    typeof message.ok === "boolean"
  ) {
    return {
      type: "pairingApproved",
      userCode: message.userCode,
      ok: message.ok,
    };
  }
  return null;
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const optionalSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

function parsePlayRequest(value: unknown): NativePlayRequest | null {
  if (!value || typeof value !== "object") return null;
  const video = value as Record<string, unknown>;
  if (typeof video.videoId !== "string" || !video.videoId) return null;
  if (typeof video.title !== "string") return null;
  return {
    videoId: video.videoId,
    title: video.title,
    channelName: optionalString(video.channelName),
    poster: optionalString(video.poster),
    startSeconds: optionalSeconds(video.startSeconds),
    durationSeconds: optionalSeconds(video.durationSeconds),
    isLive: video.isLive === true,
    autoplay: video.autoplay !== false,
  };
}

/** Reads a command from the shell; null for anything that isn't one. */
export function parseNativeAppCommand(value: unknown): NativeAppCommand | null {
  if (!value || typeof value !== "object") return null;
  const command = value as Record<string, unknown>;
  if (
    command.type === "approvePairing" &&
    typeof command.userCode === "string" &&
    command.userCode
  ) {
    return { type: "approvePairing", userCode: command.userCode };
  }
  return null;
}
