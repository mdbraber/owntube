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
    host: env.GATEWAY_HOST,
    port: env.GATEWAY_PORT,
    shutdownGraceMs: env.GATEWAY_SHUTDOWN_GRACE_MS,
    signingKey: env.GATEWAY_SIGNING_KEY,
    transport: env.GATEWAY_TRANSPORT || undefined,
    cacheDir: env.GATEWAY_CACHE_DIR || undefined,
    imageCacheMaxBytes: env.GATEWAY_IMAGE_CACHE_MAX_BYTES || undefined,
    proxyUrl: env.GATEWAY_PROXY_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid gateway configuration: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
