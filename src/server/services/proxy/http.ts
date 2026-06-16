import { upstreamGetText } from "@/server/services/upstream-get";
import {
  recordUpstreamFailure as recordInstanceFailure,
  recordUpstreamSuccess,
} from "@/server/services/upstream-health";

export const FETCH_TIMEOUT_MS = 20_000;

type FetchJsonOptions = {
  /**
   * Some upstreams (notably Invidious `/api/v1/videos/{id}/related`) return 2xx with a
   * completely empty body instead of `[]` when there are no related items.
   */
  emptyBodyAs?: unknown;
  source?: "piped" | "invidious";
  baseUrl?: string;
};

export async function fetchJson(
  url: string,
  options?: FetchJsonOptions,
): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const { status, ok, text } = await upstreamGetText(url, FETCH_TIMEOUT_MS);
    const trimmed = text.trim();
    if (!ok) {
      const hint = trimmed.slice(0, 240);
      throw new Error(
        hint ? `HTTP ${status}: ${hint}` : `HTTP ${status} (empty body)`,
      );
    }
    if (!trimmed) {
      if (options?.emptyBodyAs !== undefined) {
        if (options.source && options.baseUrl) {
          recordUpstreamSuccess(
            options.source,
            options.baseUrl,
            Date.now() - startedAt,
          );
        }
        return options.emptyBodyAs;
      }
      throw new Error(
        `HTTP ${status} with empty body (expected JSON from upstream)`,
      );
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (options?.source && options.baseUrl) {
        recordUpstreamSuccess(
          options.source,
          options.baseUrl,
          Date.now() - startedAt,
        );
      }
      return parsed;
    } catch (e) {
      const isHtml = trimmed.startsWith("<");
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        isHtml
          ? `Invalid JSON (upstream returned HTML — base URL may be the web UI, not the API; use the Piped backend URL or set PIPED_BASE_URL=disabled): ${msg}; start: ${trimmed.slice(0, 120)}`
          : `Invalid JSON: ${msg}; start: ${trimmed.slice(0, 120)}`,
      );
    }
  } catch (error) {
    if (options?.source && options.baseUrl) {
      recordInstanceFailure(
        options.source,
        options.baseUrl,
        error,
        Date.now() - startedAt,
      );
    }
    throw error;
  }
}
