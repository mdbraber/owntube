import type { InstanceSourceRow } from "@/server/services/proxy";

type InstanceSourceHintProps = {
  row: InstanceSourceRow;
};

function envLabel(row: InstanceSourceRow): string {
  if (!row.envRaw) return "not set";
  if (row.envDisabled) return `disabled (${row.envRaw})`;
  return row.envUrl ?? row.envRaw;
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs == null) return "";
  return ` · ${latencyMs}ms`;
}

function formatStatus(status: string): string {
  if (status === "cooldown") return "Cooldown";
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

export function InstanceSourceHint({ row }: InstanceSourceHintProps) {
  return (
    <ul className="space-y-0.5 text-xs text-[hsl(var(--muted-foreground))]">
      <li>
        <span className="font-medium text-[hsl(var(--foreground))]/80">
          Server (.env):
        </span>{" "}
        <code className="break-all rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[11px]">
          {envLabel(row)}
        </code>
      </li>
      {row.profileOverride ? (
        <li>
          <span className="font-medium text-[hsl(var(--foreground))]/80">
            Your override:
          </span>{" "}
          <code className="break-all rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[11px]">
            {row.profileOverride}
          </code>
        </li>
      ) : null}
      <li>
        <span className="font-medium text-[hsl(var(--foreground))]/80">
          Effective:
        </span>{" "}
        <code className="break-all rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[11px]">
          {row.urls.length > 0 ? row.urls.join(", ") : "not configured"}
        </code>
      </li>
      {row.preferredUrl ? (
        <li>
          <span className="font-medium text-[hsl(var(--foreground))]/80">
            Preferred:
          </span>{" "}
          <code className="break-all rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[11px]">
            {row.preferredUrl}
          </code>
        </li>
      ) : null}
      {row.health.map((health) => (
        <li key={`${health.source}-${health.url}`} className="space-y-0.5">
          <span className="font-medium text-[hsl(var(--foreground))]/80">
            {health.url ? formatStatus(health.status) : "Disabled"}
            {formatLatency(health.latencyMs)}:
          </span>{" "}
          <code className="break-all rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[11px]">
            {health.url ?? "not configured"}
          </code>
          {health.lastError ? (
            <span className="block whitespace-pre-wrap pl-2">
              {health.lastError}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
