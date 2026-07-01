# owntube TV (`apps/tv`)

Android TV / Fire TV lean-back client. A **thin consumer** of the existing OwnTube web
`AppRouter` over tRPC — no new backend. Built with Expo + `react-native-tvos`, ExoPlayer
playback via `expo-video`.

> **Status: Phase 1 scaffold, not yet runtime-verified.** It was written without an Android
> SDK/emulator available, so versions and native build have not been validated. Before first run,
> confirm/realign the Expo SDK + `react-native-tvos` pins with `npx expo install --check` (and the
> [react-native-tvos](https://github.com/react-native-tvos/react-native-tvos) release matched to
> the Expo SDK). Current pins target **Expo SDK 52 / RN 0.76**.
>
> **Not part of the shared pnpm install yet.** Expo SDK 52 brings React 18 / `@types/react@18`,
> which conflicts with the web app's React 19 and breaks the web typecheck when the pnpm store is
> shared. So `apps/tv` is excluded from `pnpm-workspace.yaml` and installs on its own with
> `--ignore-workspace` (below). Re-including it in the workspace requires a React-types resolution
> strategy (e.g. separate type roots, or aligning both apps once Expo ships a React 19 SDK). Until
> then the type-only `@web/*` import (see below) only resolves once both apps' deps are present.

## What it does (Phase 1)

Single screen that calls the public `video.detail` procedure for a hardcoded video id
(`src/lib/config.ts`), then plays its `hlsUrl` fullscreen via ExoPlayer with a D-pad focusable
Play/Pause control. Remote Back exits.

## Prerequisites

- Android Studio with an **Android TV** system image AVD (or a physical Fire TV / Android TV).
- The OwnTube web app running and reachable from the device. On the Android emulator the host is
  `http://10.0.2.2:3000` (default in `app.json` → `extra.owntubeUrl`). For a real device, set the
  LAN URL via `EXPO_PUBLIC_OWNTUBE_URL`. Cleartext HTTP is enabled for dev (`usesCleartextTraffic`).

## Run

```bash
# with the web app already running from the repo root (pnpm dev)
cd apps/tv
pnpm install --ignore-workspace --shamefully-hoist   # isolated install (React 18 toolchain)
EXPO_PUBLIC_OWNTUBE_URL=http://<your-lan-ip>:3000 \
  pnpm exec expo prebuild --platform android --clean
pnpm run android                        # EXPO_TV=1 expo run:android
```

The `EXPO_TV=1` env (wired into the `android`/`prebuild` scripts) is what makes
`@react-native-tvos/config-tv` generate a TV build.

`--shamefully-hoist` is required: Metro expects a flat `node_modules` and resolves
transitive runtime deps (e.g. `@babel/runtime`) from the top level. It is also set
in `.npmrc`, but pnpm ≥ 10 ignores that key at install time, so pass the flag
explicitly. (Use the repo's corepack pnpm 9.15.9, not a system-wide pnpm.)

## Monorepo / Metro notes

- `metro.config.js` watches the workspace root and resolves from both `apps/tv/node_modules` and
  the root `node_modules` (pnpm hoists shared deps). This is the most failure-prone part of an
  RN-in-pnpm setup — if a module fails to resolve, start here.
- The `AppRouter` type is imported **type-only** from `@web/server/trpc/root` (tsconfig path
  `@web/*` → `../web/src/*`). Being `import type`, Babel erases it, so Metro never bundles any
  server code; it only gives end-to-end tRPC type safety.
