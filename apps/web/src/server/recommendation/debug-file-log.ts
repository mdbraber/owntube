import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";

export function recommendationDebugEnabled(): boolean {
  const v = process.env.OWNTUBE_DEBUG_RECOMMENDATIONS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** NDJSON log path when debug is on (override with OWNTUBE_RECOMMENDATION_LOG_PATH). */
export function recommendationDebugLogFilePath(): string {
  const custom = process.env.OWNTUBE_RECOMMENDATION_LOG_PATH?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
  }
  return path.join(process.cwd(), "logs", "recommendation-debug.ndjson");
}

/** Appends one JSON line; failures are logged and do not throw. */
export async function appendRecommendationDebugLog(
  payload: Record<string, unknown>,
): Promise<void> {
  const filePath = recommendationDebugLogFilePath();
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...payload,
    });
    await appendFile(filePath, `${line}\n`, "utf8");
  } catch (err) {
    logger.warn("recommendation.debug_file_write_failed", {
      path: filePath,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
