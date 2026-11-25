import {
  isNewNativePage,
  type NativeAppCommand,
  type NativeAppMessage,
  type NativePlayRequest,
  nativeAppCommandScript,
  parseNativeAppMessage,
} from "@web/lib/native-app";
import { isVideoId, parseStartSeconds } from "@web/lib/youtube-url";
import { router, Stack, useSegments } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  type ComponentType,
  type Ref,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Share,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import WebView from "react-native-webview";
import type {
  IOSWebViewProps,
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";
import { SERVER_ORIGIN, USER_AGENT_TOKEN, webUrl } from "@/lib/config";
import { onPairingApproved, syncSession } from "@/lib/session";
import { type OpenVideo, openVideo, playVideo } from "@/player/store";
import { setWatchQueue } from "../../modules/widget-bridge";

/**
 * react-native-webview types its props as the intersection of the iOS, Android
 * and Windows props, which current React types collapse to `never`. This app
 * is iOS only, so take the iOS props.
 */
const IOSWebView = WebView as unknown as ComponentType<
  IOSWebViewProps & { ref?: Ref<WebView> }
>;

/**
 * The web app's `--background` (apps/web/src/app/globals.css), shown until the
 * first paint. Its default theme follows the system, as the app does.
 */
const BACKGROUND = { light: "#fafafa", dark: "#0a0a0b" } as const;

function isServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === SERVER_ORIGIN;
  } catch {
    return false;
  }
}

/** The video a link opens, when it's a watch link (`/watch?v=…&t=…`). */
export function watchTarget(url: string): OpenVideo | null {
  let target: URL;
  try {
    target = new URL(url, SERVER_ORIGIN);
  } catch {
    return null;
  }
  if (target.origin !== SERVER_ORIGIN) return null;
  if (target.pathname.replace(/\/+$/, "") !== "/watch") return null;
  const videoId = target.searchParams.get("v");
  if (!videoId || !isVideoId(videoId)) return null;
  const startSeconds = parseStartSeconds(target.searchParams.get("t"));
  return startSeconds ? { videoId, startSeconds } : { videoId };
}

/** A web path from a URL on the server (`/channel/…?tab=…`). */
export function webPathOf(url: string): string {
  const target = new URL(url, SERVER_ORIGIN);
  return `${target.pathname}${target.search}${target.hash}`;
}

type WebPageViewProps = {
  /** The web path to open (`/`, `/channel/…`, `/watch?v=…&panel=1`). */
  path: string;
  /** The user went to another page (`isNewNativePage`). */
  onNavigate: (url: string) => void;
  /** The page asked to play a video (a watch page). */
  onPlay: (video: NativePlayRequest) => void;
  /** The page's title and URL, on every navigation. */
  onPage?: (title: string, url: string) => void;
  /** Exposes reload/share targets to the screen's chrome. */
  webViewRef?: Ref<WebView>;
};

/**
 * One web page and its bridge to the app, without any chrome: a tab's screen
 * (WebScreen) and the player panel both show pages through it. Links off the
 * server open in a Safari sheet; link taps to other pages go to `onNavigate`.
 *
 * Every WebView shares the default website data store, so they share the
 * sign-in cookie and localStorage.
 */
export function WebPageView({
  path,
  onNavigate,
  onPlay,
  onPage,
  webViewRef,
}: WebPageViewProps) {
  const ref = useRef<WebView | null>(null);
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const [source] = useState(() => webUrl(path));
  const currentUrl = useRef(source);
  const handlers = useRef({ onNavigate, onPlay, onPage });
  handlers.current = { onNavigate, onPlay, onPage };

  const setRef = useCallback(
    (view: WebView | null) => {
      ref.current = view;
      if (typeof webViewRef === "function") webViewRef(view);
      else if (webViewRef) {
        (webViewRef as { current: WebView | null }).current = view;
      }
    },
    [webViewRef],
  );

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message: NativeAppMessage | null = parseNativeAppMessage(
      event.nativeEvent.data,
    );
    if (!message) return;
    switch (message.type) {
      case "page":
        currentUrl.current = message.url;
        handlers.current.onPage?.(message.title, message.url);
        break;
      case "queue":
        setWatchQueue(message.raw);
        break;
      case "play":
        handlers.current.onPlay(message.video);
        break;
      case "navigate":
        handlers.current.onNavigate(message.url);
        break;
      case "session":
        void syncSession(message.userId, (command: NativeAppCommand) =>
          ref.current?.injectJavaScript(nativeAppCommandScript(command)),
        ).catch(() => {});
        break;
      case "pairingApproved":
        onPairingApproved(message.userCode, message.ok);
        break;
    }
  }, []);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    if (isServerUrl(nav.url)) currentUrl.current = nav.url;
  }, []);

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      const { url, isTopFrame, navigationType } = request;
      if (!isTopFrame) return true;
      if (isServerUrl(url)) {
        // A tapped link the page didn't catch (before it hydrated, or a plain
        // <a>): handled like any other. Redirects, form posts and reloads
        // load in place.
        if (
          navigationType === "click" &&
          isNewNativePage(currentUrl.current, url)
        ) {
          handlers.current.onNavigate(url);
          return false;
        }
        return true;
      }
      if (/^(about|blob|data):/.test(url)) return true;
      if (/^https?:/.test(url)) {
        void WebBrowser.openBrowserAsync(url, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
      } else {
        void Linking.openURL(url).catch(() => {});
      }
      return false;
    },
    [],
  );

  return (
    <IOSWebView
      ref={setRef}
      source={{ uri: source }}
      style={[styles.webView, { backgroundColor: BACKGROUND[scheme] }]}
      applicationNameForUserAgent={USER_AGENT_TOKEN}
      // A new page shows a spinner until it first paints, not an empty screen.
      startInLoadingState
      renderLoading={() => (
        <View style={[styles.loading, { backgroundColor: BACKGROUND[scheme] }]}>
          <ActivityIndicator />
        </View>
      )}
      // The page insets itself by env(safe-area-inset-*) (globals.css); an
      // automatic inset on the WebView's scroll view would count it twice.
      contentInsetAdjustmentBehavior="never"
      allowsInlineMediaPlayback
      allowsPictureInPictureMediaPlayback
      allowsAirPlayForMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      // No WebKit back/forward swipe: the edge swipe is the native stack's.
      allowsBackForwardNavigationGestures={false}
      pullToRefreshEnabled
      onMessage={onMessage}
      onNavigationStateChange={onNavigationStateChange}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      // iOS reclaims a background WebView's content process under memory
      // pressure, leaving a blank page; load it again.
      onContentProcessDidTerminate={() => ref.current?.reload()}
      webviewDebuggingEnabled={__DEV__}
    />
  );
}

/**
 * The `page` route of the tab a screen is in: `/page` for Home,
 * `/<tab>/page` for the others.
 */
export function pageRouteOf(tab: string | undefined): string {
  return !tab || tab === "(home)" ? "/page" : `/${tab}/page`;
}

type Props = {
  /** The web path this screen opens (`/`, `/subscriptions`, `/channel/…`). */
  path: string;
  /** Navigation bar title until the page reports its own. */
  title: string;
};

/**
 * One web page as one native screen of a tab, YouTube-style:
 *
 * - Another page pushes a new screen onto the tab's stack (see
 *   `isNewNativePage`), so Back, the edge swipe and Back's long-press history
 *   are native, and a page is found as it was left. Changes within a page
 *   (tabs, filters) stay on its screen.
 * - A video opens the player panel over the tab instead (nothing is added to
 *   Back); swiping the panel down leaves it playing in the mini player.
 *
 * The navigation bar shows the page's title, with a menu for sharing, Safari
 * and reloading.
 */
export function WebScreen({ path, title }: Props) {
  const ref = useRef<WebView | null>(null);
  const tab = (useSegments() as string[])[1];
  const [pageTitle, setPageTitle] = useState("");
  const [currentUrl, setCurrentUrl] = useState(() => webUrl(path));

  const onNavigate = useCallback(
    (url: string) => {
      const video = watchTarget(url);
      if (video) {
        openVideo(video);
        return;
      }
      router.push({
        pathname: pageRouteOf(tab) as never,
        params: { path: webPathOf(url) },
      });
    },
    [tab],
  );

  const onPage = useCallback((titleText: string, url: string) => {
    setPageTitle(titleText);
    setCurrentUrl(url);
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: pageTitle || title }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction
            icon="square.and.arrow.up"
            onPress={() => void Share.share({ url: currentUrl })}
          >
            Share
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="safari"
            onPress={() => void Linking.openURL(currentUrl)}
          >
            Open in Safari
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="arrow.clockwise"
            onPress={() => ref.current?.reload()}
          >
            Reload
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <WebPageView
        path={path}
        webViewRef={ref}
        onNavigate={onNavigate}
        // A watch page loaded in a tab (rare: links open the panel) hands its
        // video to the panel.
        onPlay={playVideo}
        onPage={onPage}
      />
    </>
  );
}

const styles = StyleSheet.create({
  webView: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
});
