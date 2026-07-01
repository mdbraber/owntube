import Constants from "expo-constants";

/**
 * Base URL of the OwnTube web instance the TV app talks to.
 *
 * For Phase 1 this is hardcoded via `EXPO_PUBLIC_OWNTUBE_URL` (or the `extra`
 * field in app.json). A settings screen replaces this later (P3). On the
 * Android emulator, the host machine is reachable at `10.0.2.2`.
 */
const fromEnv = process.env.EXPO_PUBLIC_OWNTUBE_URL;
const fromExtra = (
  Constants.expoConfig?.extra as { owntubeUrl?: string } | undefined
)?.owntubeUrl;

export const OWNTUBE_BASE_URL = (
  fromEnv ??
  fromExtra ??
  "http://10.0.2.2:3000"
).replace(/\/$/, "");

export const TRPC_URL = `${OWNTUBE_BASE_URL}/api/trpc`;
