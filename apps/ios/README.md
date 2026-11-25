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
- **Navigation**: every page is a native screen. Tapping a link to another
  page pushes it onto the tab's stack, so Back (the button, the edge swipe,
  long-press for history) is iOS's own and returns to the page as it was left,
  scroll position included. There's no forward, as in any iOS app.
  - What counts as another page: a different path, or another video or
    playlist (`isNewNativePage` in `@web/lib/native-app`). Tabs, filters,
    sorting and a new search stay on their screen. Sign-in and onboarding move
    on in place.
  - The page reports link taps to the app (`navigate` message) instead of
    following them. A few buttons navigate programmatically; the page lets
    those through, hands them over, and goes back behind the new screen.
  - Each tab keeps its own stack, and tapping the current tab returns to its
    first screen.
  - Links from outside the app (widget, URLs) open over Home's first screen
    (`app/+native-intent.tsx`). Quick actions open in their tab the same way.
`app/library/index.tsx`): the web app's account destinations as
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
- **Native player** (`src/player`, `app/player.tsx`): inside the app, the web
  watch page doesn't mount its player. It sends the video to the app
  (`play` message) and shows the poster in its place; tapping the poster opens
  the player again. The app plays it with AVPlayer (expo-video) and Apple's own
  controls, in a sheet over the tabs. It starts with the server's HLS
  (`/hls/<id>/master.m3u8`) and falls back to what the web picks for Safari on
  iPhone (`buildWatchPlayback`). Playback continues:
  - in the mini player, the tab bar's bottom accessory, when the sheet is
    closed;
  - in Picture-in-Picture;
  - in the background, with Now Playing on the lock screen.

  Progress goes to history every 20 s and when the app leaves the
  foreground, as the TV app does. The resume position comes from the page.

  **Up next**, below the video, lists the queue first, then related videos.
  At the end of a video the queue always plays on, and related videos play on
  when the account's "Autoplay next" is on. Playing a queued video removes it
  from the queue, as on the web.
- **Settings** (`app/(tabs)/library/settings.tsx`): a native form (SwiftUI)
  with these parts:
  - the server, which you can change at runtime: it's checked, stored on the
    device and the app reloads on it;
  - Autoplay next, the account setting shared with web and TV;
  - the signed-in account;
  - a link to the full web settings.
- **Quick actions** (`src/lib/home-screen-actions.ts`): long-pressing the
  icon gives Resume (the last video played), Search, Subscriptions and Queue.
- **App session** (`src/lib/session.ts`): native API calls use a device token,
  as the TV app does. A page reports who is signed in (`session` message). If
  the app has no token for that account, it starts a device pairing and the
  page approves it with its own sign-in (`approvePairing` command, sent the
  other way). Signing out of the web drops the token.
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
cp .env.example .env    # set EXPO_PUBLIC_OWNTUBE_URL (the default server;
                        # Settings can change it on the device)
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

1. Push notifications for new uploads (needs a sender on the server).
2. Playlist context in Up next (playing on through a playlist), as the TV has.
