import { z } from "zod";

/**
 * The gateway's whole configuration, read once at startup. Nothing else in
 * the gateway reads `process.env`.
 */
const configSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  shutdownGraceMs: z.coerce.number().int().min(0).default(10_000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    host: env.GATEWAY_HOST,
    port: env.GATEWAY_PORT,
    shutdownGraceMs: env.GATEWAY_SHUTDOWN_GRACE_MS,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid gateway configuration: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
