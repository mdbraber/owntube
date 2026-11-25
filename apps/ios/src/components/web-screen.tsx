import {
  type NativeAppMessage,
  parseNativeAppMessage,
} from "@web/lib/native-app";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  type ComponentType,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Linking, Share, StyleSheet, useColorScheme } from "react-native";
import WebView from "react-native-webview";
import type {
  IOSWebViewProps,
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";
import { SERVER_ORIGIN, USER_AGENT_TOKEN, webUrl } from "@/lib/config";
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
  /** Changes to load `path` again, even when it is the same (deep links). */
  nonce?: string;
};

function isServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === SERVER_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * One of the web app's pages inside the native shell. Its navigation bar is
 * native: the page's title, a back button while the page has history (the
 * edge swipe goes back too), and a menu for sharing, Safari and reloading.
 * Links that leave the server open in an in-app Safari sheet.
 *
 * Every screen's WebView shares the default website data store, so they share
 * the sign-in cookie and localStorage.
 */
export function WebScreen({ path, title, nonce }: Props) {
  const ref = useRef<WebView>(null);
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  // The first page only; later ones are navigations inside the page (below),
  // which keep its history so Back still works.
  const [source] = useState(() => webUrl(path));
  const [pageTitle, setPageTitle] = useState("");
  const [currentUrl, setCurrentUrl] = useState(source);
  const [canGoBack, setCanGoBack] = useState(false);

  // A new path for a mounted screen (a deep link into the Home tab) opens it;
  // the nonce makes a second link to the same page open it again.
  const first = useRef(true);
  useEffect(() => {
    void nonce;
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.injectJavaScript(
      `window.location.assign(${JSON.stringify(webUrl(path))}); true;`,
    );
  }, [path, nonce]);

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
    }
  }, []);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    if (isServerUrl(nav.url)) setCurrentUrl(nav.url);
  }, []);

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      const { url, isTopFrame } = request;
      if (!isTopFrame || isServerUrl(url)) return true;
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
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="chevron.backward"
          accessibilityLabel="Back"
          hidden={!canGoBack}
          onPress={() => ref.current?.goBack()}
        />
      </Stack.Toolbar>
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
        // The page insets itself by env(safe-area-inset-*) (globals.css); an
        // automatic inset on the WebView's scroll view would count it twice.
        contentInsetAdjustmentBehavior="never"
        allowsInlineMediaPlayback
        allowsPictureInPictureMediaPlayback
        allowsAirPlayForMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures
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
});
