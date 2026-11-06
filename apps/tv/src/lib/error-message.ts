import { TRPCClientError } from "@trpc/client";
import { baseUrl } from "@/lib/config";

/**
 * Surfaces tRPC/upstream error messages (rate-limit, upstream-unavailable).
 *
 * A failure the server never shaped (no tRPC error data) means no OwnTube
 * answered: the network dropped, or a proxy sent an empty or HTML page while
 * the app restarted. Its raw text ("JSON Parse error: Unexpected end of
 * input") explains nothing, so it says which server isn't answering instead.
 * The session is left alone: only the server's UNAUTHORIZED ends it.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof TRPCClientError && !err.data) {
    return `${serverHost()} isn't answering right now. It may be restarting; try again in a moment.`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function serverHost(): string {
  try {
    return new URL(baseUrl()).host;
  } catch {
    return "The OwnTube server";
  }
}
