import { z } from "zod";

const schema = z.object({
  /** The gateway's internal address (its catalogue API is not public). */
  GATEWAY_URL: z.string().url().default("http://localhost:8080"),
  /** Shared with the gateway: the API bearer token and the playback URL HMAC key. */
  GATEWAY_SIGNING_KEY: z.string().min(32),
  /** How long a signed playback URL stays valid, in seconds. */
  GATEWAY_PLAYBACK_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 3600),
});

export type GatewayConfig = {
  url: string;
  signingKey: string;
  playbackTtlSec: number;
};

let loaded: GatewayConfig | undefined;

/** Read on first use, so builds and tests that never reach the gateway need no key. */
export function gatewayConfig(): GatewayConfig {
  if (loaded) return loaded;
  // Compose passes optional settings through as empty strings: treat those as unset.
  const env = schema.parse({
    GATEWAY_URL: process.env.GATEWAY_URL || undefined,
    GATEWAY_SIGNING_KEY: process.env.GATEWAY_SIGNING_KEY,
    GATEWAY_PLAYBACK_TTL_SEC: process.env.GATEWAY_PLAYBACK_TTL_SEC || undefined,
  });
  loaded = {
    url: env.GATEWAY_URL,
    signingKey: env.GATEWAY_SIGNING_KEY,
    playbackTtlSec: env.GATEWAY_PLAYBACK_TTL_SEC,
  };
  return loaded;
}
