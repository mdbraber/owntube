# OwnTube for iPhone and iPad (`apps/ios`)

An Expo app that puts the OwnTube web app in a native iOS shell. iOS draws
the tab bar, navigation bars, menus, search field and lists, with Liquid Glass
on iOS 26 and later. The web app's pages fill the space in between. The server
address is configuration, not code.

It replaces the earlier Tauri shell. Like that shell, it plays video
inline, in Picture-in-Picture and with the screen off (`UIBackgroundModes:
audio`), none of which the home-screen PWA can do. Being Expo, it shares its
toolchain and patterns with `apps/tv`.

## How it fits together

- **Native tabs** (`app/_layout.tsx`): Home, Subscriptions, Library and the
  system Search tab, each with its own navigation stack.
- **Web pages** (`src/components/web-screen.tsx`): one WebView per screen. Each
  gets a native navigation bar showing the page's title, a back button while
  the page has history (the edge swipe goes back too), and a menu with Share,
  Open in Safari and Reload. Links that leave the server open in a Safari
  sheet. All WebViews share one cookie store and localStorage.
- **Library** (`app/library/index.tsx`): the web app's account destinations as
  a native SwiftUI list (`@expo/ui`).
- **Embedded mode in the web app**: the WebView adds `OwnTubeApp/<version>` to
  its user agent. The server sees it (`apps/web/src/lib/native-app.ts`) and
  leaves its own top bar, sidebar and bottom tab bar out of the first render.
  The page pads itself by the safe area, so content scrolls under the glass
  bars.
- **Bridge**: inside the app, the page sends messages through
  `window.ReactNativeWebView` (`components/native-app/native-app-bridge.tsx`).
  It reports its title and URL on every navigation, and the watch queue for the
  widget. Both sides share the message types in `@web/lib/native-app`.
- **Links** (`src/lib/use-incoming-links.ts`, `src/lib/app-path.ts`): these open
  in the Home tab, whether they launch the app or arrive while it runs:
  - `owntube://watch?v=<id>` (the widget)
  - `owntube://watch/<id>` (Privacy Redirect)
  - `owntube://<any web path>`
  - YouTube URLs

  YouTube-shaped paths are canonicalised by the web middleware.
- **Widget** (`targets/widget`, `plugins/with-widget.js`): "Continue watching"
  from the queue. The app's `widget-bridge` module writes the queue to the App
  Group `group.<bundle id>` and reloads the widget. Built the same way as the
  TV app's Top Shelf (`apps/tv/plugins/with-top-shelf.js`).

## Setup

`apps/ios` is installed on its own, outside the repo's pnpm workspace (see the
root `pnpm-workspace.yaml`). Its own `pnpm-workspace.yaml` makes the
`node_modules` flat (`nodeLinker: hoisted`), which React Native needs.

```sh
cd apps/ios
pnpm install
cp .env.example .env    # set EXPO_PUBLIC_OWNTUBE_URL
pnpm prebuild           # generates ios/ (gitignored) from app.json + plugins
pnpm ios                # build, install and run on a simulator or device
```

To run on a phone, open `ios/OwnTube.xcworkspace` in Xcode, pick your team
under Signing & Capabilities for both the OwnTube and OwnTubeWidget targets,
and run. The App Group must be enabled for both; Xcode's automatic signing
registers it.

If `EXPO_PUBLIC_OWNTUBE_URL` points at a host on your home network, the phone
has to be able to reach it (same Wi‑Fi, or VPN/Tailscale).

## App icon

`assets/icon.png` is generated from the web logo, like the TV app's icons:

```sh
pnpm --filter web export:icons   # from the repo root
```

## Next steps

1. **Native player**: `expo-video` (AVPlayer) for reliable background audio,
   Now Playing / lock screen controls, PiP and AirPlay. The web page hands
   playback over through the bridge. This needs the device-token sign-in the
   TV app uses, so native code can call the API.
2. Home-screen quick actions (`expo-quick-actions`), native settings.
3. Push notifications for new uploads (needs a sender on the server).
