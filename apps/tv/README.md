# OwnTube TV (`apps/tv`)

Android TV / Fire TV lean-back client for OwnTube. It is a **thin consumer** of the web app's
`AppRouter` over tRPC and has no backend of its own. Built with Expo SDK 52 +
`react-native-tvos` 0.76; playback is ExoPlayer through `expo-video`.

Roadmap: [`docs/TV-PARITY-PLAN.md`](../../docs/TV-PARITY-PLAN.md).

## What it does

- **Sign-in** by device pairing (code + QR, approved from the web app), with email + password as
  a fallback. Several accounts can be paired: "Who's watching" at start, and Settings → Switch or
  add profile. An expired session returns to sign-in.
- **Home** mirrors the web home: a hero, Continue watching, then the user's web home blocks as
  rows. **Sections** in a D-pad sidebar (order editable in Settings): Home, Search (text and
  voice, suggestions, recent searches, channel results, sort), Queue, Subscriptions (every
  channel, tags, new-upload dots), Recommended (with a Shorts row), Trending, Shorts (vertical
  player, Up/Down between shorts), Saved, Playlists, History, Settings. Channel pages have
  Videos / Shorts / Playlists / Similar tabs and tag chips.
- **Long-press OK** on any card opens its menu: queue, save, save to playlist, mark watched, not
  interested, don't recommend channel, go to channel, plus reorder/remove on Queue, Playlists and
  History.
- **Player**: server DASH (`/dash/<id>/manifest.mpd`, with `maxHeight` for the quality choice) and
  fallbacks, live via `/dash/<id>/live.mpd` (LIVE badge, Go live), a settings panel (quality,
  captions, audio language, speed, chapters, save to playlist, stats), SponsorBlock marks and
  skip/undo, subscribe, description and comments, and an Up next card that plays on through the
  queue, a playlist or the row a video came from (remote next/previous keys too). Upcoming,
  age-restricted and unavailable videos say so, with Retry.
- **Android TV**: videos left part-way appear in the launcher's Continue watching row
  (`modules/watch-next`); YouTube links offer OwnTube in "Open with"; now-playing metadata for the
  system and the Assistant; **Play on TV** from the web watch page reaches a TV that is on.

Settings shared with the web (playback quality, autoplay, SponsorBlock, home blocks…) are read
from and written to `settings.*` on the server; device-only preferences (sidebar order, caption
language, speed, recent searches, profiles) stay on the TV.

## Server

On first run the TV asks for the OwnTube server (the address you open in a
browser). It checks that an OwnTube answers there, then goes to sign-in.
Settings → Server → Change server signs out and asks again. The build's
`EXPO_PUBLIC_OWNTUBE_URL` (default `http://10.0.2.2:3000`, the host as seen from
the emulator) is only the pre-filled suggestion. Installs that were already
signed in before this setting existed keep using the URL they were built with.

## Build

```bash
EXPO_PUBLIC_OWNTUBE_URL=https://owntube.example.org CI=1 pnpm run prebuild   # EXPO_TV=1 expo prebuild
cd android
EXPO_PUBLIC_OWNTUBE_URL=https://owntube.example.org NODE_ENV=production \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon
# → android/app/build/outputs/apk/release/app-release.apk (debug-signed for now)
```

- `EXPO_TV=1` (set by the `prebuild`/`android` scripts) makes `@react-native-tvos/config-tv`
  generate a TV build.
- Gradle does not track `EXPO_PUBLIC_*`: after changing only the URL, delete
  `app/build/generated/{assets,res}/createBundleReleaseJsAndAssets` or the old URL stays in the
  bundle.
- RN 0.76 needs NDK 26.1 (`ndk;26.1.10909125`) and SDK 35 (`platforms;android-35`,
  `build-tools;35.0.0`).
- For development against Metro instead: `pnpm run android`.
- `EXPO_PUBLIC_BUILD_ID=<git sha>` shows the build in Settings → About.

## Releases

- **Version:** every release bumps `version` in `package.json`, and only there. It follows
  [semver](https://semver.org): patch (0.2.0 → 0.2.1) for bug fixes, minor (0.2.1 → 0.3.0) for
  new features, major for breaking changes (e.g. a TV build that needs a newer server).
  `android.versionCode`, which the update check and Android's installer compare, is derived:
  major × 10000 + minor × 100 + patch (0.4.0 → 400), so minor and patch stay below 100.
  `app.config.js` sets both for Expo, and the `with-version-from-package` plugin makes gradle
  read them from `package.json` at build time, so a bump needs no new `expo prebuild`.
- **Signing:** set `OWNTUBE_TV_KEYSTORE` (plus `OWNTUBE_TV_KEYSTORE_PASSWORD`,
  optionally `OWNTUBE_TV_KEY_ALIAS` / `OWNTUBE_TV_KEY_PASSWORD`) for both
  prebuild and gradle. `plugins/with-release-signing.js` then signs the release
  build with that key instead of the debug key. Keep the keystore outside the
  repo. Create one once:
  `keytool -genkeypair -v -keystore owntube-tv.jks -alias owntube-tv -keyalg RSA -keysize 2048 -validity 10000`.
  A TV with a debug-signed build has to uninstall it before the first
  release-signed install, because Android refuses a signature change.
- **Publishing an update:** put the APK and an `update.json` in the web app's
  TV releases directory (`$OWNTUBE_TV_RELEASES_DIR`, default
  `apps/web/data/tv-releases/`):

  ```json
  { "version": "0.4.0", "versionCode": 400,
    "apkUrl": "/tv/download/owntube-tv-0.4.0.apk", "notes": "What changed" }
  ```

  The server serves it at `/tv/update.json` and the APK at
  `/tv/download/<file>.apk`. Settings → About on the TV shows "Update
  available" with the download URL, e.g. for the Downloader app.

The Android toolchain does not need to be installed on the host: the
`reactnativecommunity/react-native-android` Docker image works, with the repo copied (not
bind-mounted, if it is not writable by the container user) and the SDK, Gradle cache and pnpm
store on volumes.

## Test on the emulator

```bash
yes | sdkmanager "emulator" "system-images;android-34;android-tv;x86"
echo no | avdmanager create avd -n tv -k "system-images;android-34;android-tv;x86" -d tv_1080p
emulator -avd tv -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect &
adb wait-for-device && adb shell getprop sys.boot_completed      # wait for "1"

adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell monkey -p com.mdbraber.owntube.tv -c android.intent.category.LEANBACK_LAUNCHER 1
adb shell input keyevent DPAD_DOWN        # UP / LEFT / RIGHT / CENTER / BACK
adb exec-out screencap -p > shot.png
adb logcat -d -s ReactNativeJS:V ExoPlayerImpl:V AndroidRuntime:E
```

- The API 34 TV image is **x86 only** (no x86_64): build with `-PreactNativeArchitectures=x86`
  for the emulator.
- The emulator needs `/dev/kvm` access (in a container: `--device /dev/kvm` and a user that can
  open it).
- Sign in by reading the pairing code off a screenshot and approving it at `/tv/pair` on the web
  app (codes expire after 10 minutes; relaunch for a fresh one).

## Monorepo / Metro notes

- `metro.config.js` watches the workspace root and resolves from both `apps/tv/node_modules` and
  the root `node_modules`. If a module fails to resolve, start here.
- `unstable_enablePackageExports` is on because some deps (e.g. `copy-anything` via superjson)
  are exports-only.
