import { isPlaceholderSecret } from "@owntube/contracts/secrets";
import { z } from "zod";

/**
 * The gateway's whole configuration, read once at startup. Nothing else in
 * the gateway reads `process.env`.
 */
const configSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  shutdownGraceMs: z.coerce.number().int().min(0).default(10_000),
  /** HMAC key shared with whoever signs playback URLs (the web app). */
  signingKey: z
    .string()
    .min(32, "GATEWAY_SIGNING_KEY must be at least 32 characters"),
  /**
   * `auto`: byte ranges, stepping down to SABR when YouTube refuses them;
   * `sabr`: SABR from the start (for when YouTube has closed byte ranges).
   */
  transport: z.enum(["auto", "sabr"]).default("auto"),
  /**
   * A Chromium for minting PO tokens when YouTube demands SABR attestation
   * (the third transport step). Unset: no tokens; a rejection gets a fresh
   * identity instead.
   */
  poBrowser: z.string().optional(),
  /**
   * Which address family YouTube traffic leaves over. `auto` follows the
   * host's preference (IPv6 where it has it); on naggon on 2026-11-26 the IPv6
   * /64 drew bot checks that IPv4 did not.
   */
  egressFamily: z.enum(["auto", "ipv4", "ipv6"]).default("auto"),
  /** Where the image cache lives. */
  cacheDir: z.string().default("data/cache"),
  /** Image cache size kept by the hourly prune. */
  imageCacheMaxBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024 * 1024),
  /** Optional outbound proxy for all YouTube traffic. */
  proxyUrl: z.string().url().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    host: env.GATEWAY_HOST || undefined,
    port: env.GATEWAY_PORT || undefined,
    shutdownGraceMs: env.GATEWAY_SHUTDOWN_GRACE_MS || undefined,
    signingKey: env.GATEWAY_SIGNING_KEY,
    transport: env.GATEWAY_TRANSPORT || undefined,
    egressFamily: env.GATEWAY_EGRESS_FAMILY || undefined,
    poBrowser: env.GATEWAY_PO_BROWSER || undefined,
    cacheDir: env.GATEWAY_CACHE_DIR || undefined,
    imageCacheMaxBytes: env.GATEWAY_IMAGE_CACHE_MAX_BYTES || undefined,
    proxyUrl: env.GATEWAY_PROXY_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid gateway configuration: ${z.prettifyError(parsed.error)}`,
    );
  }
  // The example env files' placeholders pass the length check; a production
  // gateway must not run on a publicly known key. Development may.
  if (
    env.NODE_ENV === "production" &&
    isPlaceholderSecret(parsed.data.signingKey)
  ) {
    throw new Error(
      "Invalid gateway configuration: GATEWAY_SIGNING_KEY is still the example placeholder; generate one with `openssl rand -base64 48`",
    );
  }
  return parsed.data;
}
