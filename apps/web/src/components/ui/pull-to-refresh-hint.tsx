import { PULL_THRESHOLD } from "@/hooks/use-pull-to-refresh";

function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`h-3.5 w-3.5${spinning ? " animate-spin" : ""}`}
      aria-hidden
    >
      <title>Refreshing</title>
      <path
        d="M21 12a9 9 0 1 1-6.219-8.56"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The touch pull-to-refresh indicator: collapses to zero height when idle,
 * grows with the pull distance, and flips its label once past the threshold.
 * Pair with {@link usePullToRefresh}.
 */
export function PullToRefreshHint({ pull }: { pull: number }) {
  const active = pull > 0;
  return (
    <div
      aria-hidden={!active}
      className="flex items-center justify-center overflow-hidden text-xs text-[hsl(var(--muted-foreground))] transition-[height] duration-150"
      style={{ height: active ? pull : 0 }}
    >
      {active ? (
        <span className="flex items-center gap-2">
          <Spinner spinning={pull >= PULL_THRESHOLD} />
          {pull >= PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
        </span>
      ) : null}
    </div>
  );
}
