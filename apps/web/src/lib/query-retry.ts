/**
 * True for failures worth retrying: a dropped connection (no HTTP response, so
 * no httpStatus) or a transient server error (5xx). A tRPC error that reached
 * the server with a 4xx is permanent (not found, bad input, auth) — don't retry.
 *
 * Shared with the TV app so both clients treat failures the same way.
 */
export function isTransientNetworkError(error: unknown): boolean {
  const status = (
    error as { data?: { httpStatus?: number } } | null | undefined
  )?.data?.httpStatus;
  if (status === undefined || status === 0) return true;
  return status >= 500;
}
