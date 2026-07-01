import { useEffect, useState } from "react";

type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * Minimal data hook over the vanilla tRPC client — the TV app has no
 * @trpc/react-query provider, and a handful of screens don't justify pulling
 * one in. Re-runs when `deps` change; ignores stale resolutions on unmount.
 *
 * No caching/retry/dedup. Add @trpc/react-query only if cross-screen
 * cache reuse or background refetch becomes a real need.
 */
export function useQuery<T>(
  queryFn: () => Promise<T>,
  deps: readonly unknown[],
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    queryFn()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
    // queryFn identity is owned by the caller via deps.
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are explicit
  }, deps);

  return state;
}

/** Surfaces tRPC/upstream error messages (rate-limit, upstream-unavailable). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
