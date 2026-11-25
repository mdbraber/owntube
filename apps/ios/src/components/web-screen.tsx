import {
  isNewNativePage,
  type NativeAppCommand,
  type NativeAppMessage,
  nativeAppCommandScript,
  parseNativeAppMessage,
} from "@web/lib/native-app";
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
import { playVideo } from "@/player/store";
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

type Props = {
  /** The web path this screen opens (`/`, `/subscriptions`, `/watch?v=…`). */
  path: string;
  /** Navigation bar title until the page reports its own. */
  title: string;
};

function isServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === SERVER_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * The `page` route of the tab this screen is in: `/page` for Home,
 * `/<tab>/page` for the others.
 */
function pageRouteOf(segments: string[]): string {
  const tab = segments[1];
  return !tab || tab === "(home)" ? "/page" : `/${tab}/page`;
}

/**
 * Pushes a web page onto the current tab's stack, as its own screen.
 */
function usePushPage() {
  const segments = useSegments();
  return useCallback(
    (url: string) => {
      const target = new URL(url, SERVER_ORIGIN);
      router.push({
        pathname: pageRouteOf(segments) as never,
        params: { path: `${target.pathname}${target.search}${target.hash}` },
      });
    },
    [segments],
  );
}

/**
 * One web page in the native shell, as one native screen.
 *
 * Going to another page pushes a new screen onto the tab's stack (the page
 * reports it with a `navigate` message, see `isNewNativePage`), so Back, the
 * edge swipe and Back's long-press history are all native, and returning to a
 * page finds it as it was left. Changes within a page (tabs, filters) stay on
 * its screen. The navigation bar shows the page's title, with a menu for
 * sharing, Safari and reloading. Links off the server open in a Safari sheet.
 *
 * Every screen's WebView shares the default website data store, so they share
 * the sign-in cookie and localStorage.
 */
export function WebScreen({ path, title }: Props) {
  const ref = useRef<WebView>(null);
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const pushPage = usePushPage();
  const pushPageRef = useRef(pushPage);
  pushPageRef.current = pushPage;
  const [source] = useState(() => webUrl(path));
  const [pageTitle, setPageTitle] = useState("");
  const [currentUrl, setCurrentUrl] = useState(source);
  const currentUrlRef = useRef(currentUrl);
  currentUrlRef.current = currentUrl;

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message: NativeAppMessage | null = parseNativeAppMessage(
      event.nativeEvent.data,
    );
    if (!message) return;
    switch (message.type) {
      case "page":
        setPageTitle(message.title);
        setCurrentUrl(message.url);
        break;
      case "queue":
        setWatchQueue(message.raw);
        break;
      case "play":
        // When Up next moves on, this page follows: it becomes the watch page
        // of what's playing (replaced, not stacked), so closing the player
        // shows that video's details and Back still leaves to where you were.
        playVideo(message.video, {
          follow: (videoId) =>
            ref.current?.injectJavaScript(
              `window.location.replace(${JSON.stringify(
                webUrl(`/watch?v=${encodeURIComponent(videoId)}`),
              )}); true;`,
            ),
        });
        break;
      case "navigate":
        pushPageRef.current(message.url);
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
    if (isServerUrl(nav.url)) setCurrentUrl(nav.url);
  }, []);

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      const { url, isTopFrame, navigationType } = request;
      if (!isTopFrame) return true;
      if (isServerUrl(url)) {
        // A tapped link the page didn't catch (before it hydrated, or a plain
        // <a>): a new page is a new screen here too. Redirects, form posts
        // and reloads load in place.
        if (
          navigationType === "click" &&
          isNewNativePage(currentUrlRef.current, url)
        ) {
          pushPageRef.current(url);
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
      <IOSWebView
        ref={ref}
        source={{ uri: source }}
        style={[styles.webView, { backgroundColor: BACKGROUND[scheme] }]}
        applicationNameForUserAgent={USER_AGENT_TOKEN}
        // A pushed screen shows a spinner until its page first paints, rather
        // than an empty screen.
        startInLoadingState
        renderLoading={() => (
          <View
            style={[styles.loading, { backgroundColor: BACKGROUND[scheme] }]}
          >
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
