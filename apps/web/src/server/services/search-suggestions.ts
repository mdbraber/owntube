import { z } from "zod";
import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { logger } from "@/lib/logger";
import {
  type ProxySourceOverrides,
  resolveProxyBaseCandidates,
} from "@/server/services/proxy";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";
import { upstreamGetText } from "@/server/services/upstream-get";
import {
  recordUpstreamFailure,
  recordUpstreamSuccess,
} from "@/server/services/upstream-health";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_SUGGESTIONS = 10;

export const searchSuggestionsInputSchema = z.object({
  q: z.string().max(200),
  region: z.string().length(2).optional(),
});

export type SearchSuggestionsInput = z.infer<
  typeof searchSuggestionsInputSchema
>;

export const searchSuggestionsResultSchema = z.object({
  suggestions: z.array(z.string()),
  sourceUsed: z.enum(["piped", "invidious"]).nullable(),
});

export type SearchSuggestionsResult = z.infer<
  typeof searchSuggestionsResultSchema
>;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function sanitizeSuggestionStrings(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value || value.length > 200) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function parseInvidiousSuggestions(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const suggestions = (json as { suggestions?: unknown }).suggestions;
  return sanitizeSuggestionStrings(suggestions);
}

async function fetchSuggestionsJson(
  url: string,
  source: "piped" | "invidious",
  baseUrl: string,
): Promise<unknown> {
  acquireUpstreamSlot();
  const startedAt = Date.now();
  try {
    const { status, ok, text } = await upstreamGetText(url, FETCH_TIMEOUT_MS);
    const trimmed = text.trim();
    if (!ok) {
      throw new Error(
        trimmed
          ? `HTTP ${status}: ${trimmed.slice(0, 120)}`
          : `HTTP ${status} (empty body)`,
      );
    }
    recordUpstreamSuccess(source, baseUrl, Date.now() - startedAt);
    if (!trimmed) return [];
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    recordUpstreamFailure(source, baseUrl, error, Date.now() - startedAt);
    throw error;
  }
}

export async function fetchSearchQuerySuggestions(
  input: SearchSuggestionsInput,
  overrides?: ProxySourceOverrides,
): Promise<SearchSuggestionsResult> {
  const q = input.q.trim();
  if (!q) {
    return searchSuggestionsResultSchema.parse({
      suggestions: [],
      sourceUsed: null,
    });
  }

  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);

  for (const pipedBase of pipedBases) {
    try {
      const url = new URL("/suggestions", `${normalizeBaseUrl(pipedBase)}/`);
      url.searchParams.set("query", q);
      const json = await fetchSuggestionsJson(
        url.toString(),
        "piped",
        pipedBase,
      );
      const suggestions = sanitizeSuggestionStrings(json);
      if (suggestions.length > 0) {
        return searchSuggestionsResultSchema.parse({
          suggestions,
          sourceUsed: "piped",
        });
      }
    } catch (e) {
      logger.warn("search_suggestions.piped.failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const invidiousBase of invidiousBases) {
    if (invidiousPortCollidesWithNextApp(invidiousBase)) continue;
    try {
      const url = new URL(
        "/api/v1/search/suggestions",
        `${normalizeBaseUrl(invidiousBase)}/`,
      );
      url.searchParams.set("q", q);
      if (input.region) {
        url.searchParams.set("region", input.region.toUpperCase());
      }
      const json = await fetchSuggestionsJson(
        url.toString(),
        "invidious",
        invidiousBase,
      );
      const suggestions = parseInvidiousSuggestions(json);
      if (suggestions.length > 0) {
        return searchSuggestionsResultSchema.parse({
          suggestions,
          sourceUsed: "invidious",
        });
      }
    } catch (e) {
      logger.warn("search_suggestions.invidious.failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return searchSuggestionsResultSchema.parse({
    suggestions: [],
    sourceUsed: null,
  });
}
