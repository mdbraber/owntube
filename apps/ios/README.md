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

- **Native tabs** (`app/(tabs)/_layout.tsx`): Home, Subscriptions, Library and
  the system Search tab, each with its own navigation stack.
- **Web pages** (`src/components/web-screen.tsx`): one WebView per screen,
  with a native navigation bar: the page's title, Back, and a menu with Share,
  Open in Safari and Reload. Links that leave the server open in a Safari
  sheet. All WebViews share one cookie store and localStorage.
- **Navigation**, as in YouTube's app:
  - Every page except a video is a native screen. A link to another page
    pushes it onto the tab's stack, so Back (the button, the edge swipe,
    long-press for history) is iOS's own and returns to the page as it was
    left. There's no forward, as in any iOS app.
  - What counts as another page: a different path, or another video or
    playlist (`isNewNativePage` in `@web/lib/native-app`). Tabs, filters,
    sorting and a new search stay on their screen. Sign-in and onboarding
    move on in place.
  - The page reports link taps to the app (`navigate` message) instead of
    following them. The few programmatic navigations are let through, handed
    over, and undone behind the new screen.
  - Each tab keeps its own stack, and tapping the current tab returns to its
    first screen.
- **Player panel** (`app/player.tsx`, `src/player`), as in YouTube's app:
  - A video opens in one panel that slides up over what you were browsing,
    with nothing added to Back. The native video (AVPlayer via expo-video,
    Apple's own controls) is on top. Below it is the video's web page in
    panel mode (`/watch?v=…&panel=1`, without its own player): title,
    channel, actions, description, comments and related videos.
  - Swipe the panel down (or tap the chevron) and the video plays on in the
    mini player above the tab bar, with you back where you were. Tapping the
    mini player opens the panel again.
  - Another video tapped in the panel replaces this one in place.
  - Any other page tapped in the panel (the channel…) swipes the panel away
    and opens in the tab you were browsing.
  - Playback goes on in Picture-in-Picture and in the background, with Now
    Playing on the lock screen. It starts with the server's HLS
    (`/hls/<id>/master.m3u8`) and falls back to what the web picks for Safari
    on iPhone (`buildWatchPlayback`). A stream that never starts fails over
    after 30 s, and an error offers Try again.
  - The panel's page reports the title, artwork and resume position (`play`
    message). Progress goes to history every 20 s and when the app leaves
    the foreground, as the TV app does.
  - At the end of a video the queue plays on, then related videos when the
    account's "Autoplay next" is on. Playing a queued video removes it from
    the queue.
- **Library** (`app/(tabs)/library/index.tsx`): the web app's account
  destinations as a native SwiftUI list (`@expo/ui`).
- **Embedded mode in the web app**: the WebView adds `OwnTubeApp/<version>` to
  its user agent. The server sees it (`apps/web/src/lib/native-app.ts`) and
  leaves its own top bar, sidebar and bottom tab bar out of the first render.
  The page pads itself by the safe area, so content scrolls under the glass
  bars.
- **Bridge**: inside the app, the page sends messages through
  `window.ReactNativeWebView` (`components/native-app/native-app-bridge.tsx`):
  its title and URL, link taps, the video it shows, who is signed in, and the
  watch queue for the widget. Both sides share the message types in
  `@web/lib/native-app`.
- **Links** (`app/+native-intent.tsx`, `src/lib/app-path.ts`): these open
  whether they launch the app or arrive while it runs. A video opens in the
  player panel; any other page opens as a new screen over Home:
  - `owntube://watch?v=<id>` (the widget)
  - `owntube://watch/<id>` (Privacy Redirect)
  - `owntube://<any web path>`
  - YouTube URLs

  YouTube-shaped paths are canonicalised by the web middleware.
- **Settings** (`app/(tabs)/library/settings.tsx`): a native form (SwiftUI)
  with these parts:
  - the server, which you can change at runtime: it's checked, stored on the
    device and the app reloads on it;
  - Autoplay next, the account setting shared with web and TV;
  - the signed-in account;
  - a link to the full web settings.
- **Quick actions** (`src/lib/home-screen-actions.ts`): long-pressing the
  icon gives Resume (the last video played, in the panel), Search,
  Subscriptions and Queue.
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
