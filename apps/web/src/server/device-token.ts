import { decode, encode } from "next-auth/jwt";

// Encrypted JWTs for TV/native clients that have no cookie jar. Same crypto and
// AUTH_SECRET as the Auth.js web session, but a distinct salt so the two token
// kinds never collide. The Bearer path in createTRPCContext decodes these.
const DEVICE_TOKEN_SALT = "owntube.device-token";
const DEVICE_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

export function createDeviceToken(userId: number): Promise<string> {
  return encode({
    token: { sub: String(userId) },
    secret: secret(),
    salt: DEVICE_TOKEN_SALT,
    maxAge: DEVICE_TOKEN_MAX_AGE,
  });
}

export async function userIdFromDeviceToken(
  token: string,
): Promise<number | null> {
  try {
    const decoded = await decode({
      token,
      secret: secret(),
      salt: DEVICE_TOKEN_SALT,
    });
    const id = decoded?.sub ? Number.parseInt(decoded.sub, 10) : Number.NaN;
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}
