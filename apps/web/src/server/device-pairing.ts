import { randomBytes } from "node:crypto";
import { createDeviceToken } from "@/server/device-token";

const USER_CODE_LENGTH = 8;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_TTL_MS = 10 * 60 * 1000;

type DevicePairingSession = {
  userCode: string;
  deviceCode: string;
  expiresAt: number;
  approvedUserId: number | null;
  issuedToken: string | null;
};

type DevicePairingStore = {
  sessions: Map<string, DevicePairingSession>;
};

declare global {
  var __owntubeDevicePairingStore: DevicePairingStore | undefined;
}

function getDevicePairingStore(): DevicePairingStore {
  if (!globalThis.__owntubeDevicePairingStore) {
    globalThis.__owntubeDevicePairingStore = { sessions: new Map() };
  }
  return globalThis.__owntubeDevicePairingStore;
}

const store = getDevicePairingStore();

function nowMs(): number {
  return Date.now();
}

function cleanupExpiredPairingSessions(now = nowMs()) {
  for (const [userCode, session] of store.sessions.entries()) {
    if (session.expiresAt <= now) {
      store.sessions.delete(userCode);
    }
  }
}

function randomUserCode(): string {
  const bytes = randomBytes(USER_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i += 1) {
    code += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function randomDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function normalizeDevicePairingUserCode(userCode: string): string {
  const compact = userCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (compact.length !== USER_CODE_LENGTH) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function startDevicePairing() {
  cleanupExpiredPairingSessions();

  let userCode = randomUserCode();
  while (store.sessions.has(userCode)) {
    userCode = randomUserCode();
  }

  const session: DevicePairingSession = {
    userCode,
    deviceCode: randomDeviceCode(),
    expiresAt: nowMs() + PAIRING_TTL_MS,
    approvedUserId: null,
    issuedToken: null,
  };
  store.sessions.set(userCode, session);

  return {
    userCode,
    deviceCode: session.deviceCode,
    expiresAt: session.expiresAt,
    verificationPath: `/tv/pair?code=${encodeURIComponent(userCode)}`,
  };
}

export function approveDevicePairing(userCodeRaw: string, userId: number) {
  cleanupExpiredPairingSessions();

  const userCode = normalizeDevicePairingUserCode(userCodeRaw);
  const session = userCode ? store.sessions.get(userCode) : undefined;
  if (!session) {
    return { status: "expired" as const };
  }

  session.approvedUserId = userId;
  return { status: "approved" as const, expiresAt: session.expiresAt };
}

export async function pollDevicePairing({
  deviceCode,
  userCode: userCodeRaw,
}: {
  userCode: string;
  deviceCode: string;
}) {
  cleanupExpiredPairingSessions();

  const userCode = normalizeDevicePairingUserCode(userCodeRaw);
  const session = userCode ? store.sessions.get(userCode) : undefined;
  if (!session || session.deviceCode !== deviceCode) {
    return { status: "expired" as const };
  }

  if (!session.approvedUserId) {
    return { status: "pending" as const, expiresAt: session.expiresAt };
  }

  session.issuedToken ??= await createDeviceToken(session.approvedUserId);
  return {
    status: "approved" as const,
    token: session.issuedToken,
    expiresAt: session.expiresAt,
  };
}

export function resetDevicePairingSessionsForTests() {
  store.sessions.clear();
}
