import type { NativeAppCommand } from "@web/lib/native-app";
import * as SecureStore from "expo-secure-store";

/**
 * The app's own API session (a device token, as the TV app has), for the API
 * calls native code makes. It follows the web sign-in in the WebViews: a page
 * reports who is signed in (`session` message), and when the app has no token
 * for that account it starts a device pairing, which the page approves with
 * its cookie (`approvePairing` command). Signing out of the web drops it.
 */
const KEY = "owntube.session";

type Stored = { token: string; userId: number };

let cached: Stored | null | undefined;
let pairing: Promise<void> | null = null;
const approvals = new Map<string, (ok: boolean) => void>();

async function read(): Promise<Stored | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? (JSON.parse(raw) as Stored) : null;
    cached =
      parsed &&
      typeof parsed.token === "string" &&
      typeof parsed.userId === "number"
        ? parsed
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

async function write(value: Stored | null) {
  cached = value;
  if (value) await SecureStore.setItemAsync(KEY, JSON.stringify(value));
  else await SecureStore.deleteItemAsync(KEY).catch(() => {});
}

/** Drops the app's session (the server changed). */
export async function forgetSession(): Promise<void> {
  await write(null);
}

/** The signed-in account's id, when the app has a session. */
export async function sessionUserId(): Promise<number | null> {
  return (await read())?.userId ?? null;
}

export async function getToken(): Promise<string | null> {
  return (await read())?.token ?? null;
}

/** A page's `pairingApproved` answer. */
export function onPairingApproved(userCode: string, ok: boolean) {
  approvals.get(userCode)?.(ok);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A page reported who is signed in. `send` delivers a command to that page.
 */
export async function syncSession(
  userId: number | null,
  send: (command: NativeAppCommand) => void,
): Promise<void> {
  if (userId === null) {
    if (await read()) await write(null);
    return;
  }
  if ((await read())?.userId === userId) return;
  pairing ??= pair(userId, send).finally(() => {
    pairing = null;
  });
  return pairing;
}

async function pair(
  userId: number,
  send: (command: NativeAppCommand) => void,
): Promise<void> {
  // Imported here: trpc.ts reads the token from this module.
  const { trpc } = await import("@/lib/trpc");
  const { userCode, deviceCode } = await trpc.auth.startDevicePairing.mutate();
  const approved = await new Promise<boolean>((resolve) => {
    approvals.set(userCode, resolve);
    setTimeout(() => resolve(false), 15_000);
    send({ type: "approvePairing", userCode });
  }).finally(() => approvals.delete(userCode));
  if (!approved) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await trpc.auth.pollDevicePairing.query({
      userCode,
      deviceCode,
    });
    if (result.status === "approved") {
      await write({ token: result.token, userId });
      return;
    }
    if (result.status === "expired") return;
    await sleep(500);
  }
}
