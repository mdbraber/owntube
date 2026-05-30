import type { InstanceSourceRow } from "@/server/services/proxy";

type InstanceSourceHintProps = {
  row: InstanceSourceRow;
};

function envLabel(row: InstanceSourceRow): string {
  if (!row.envRaw) return "not set";
  if (row.envDisabled) return `disabled (${row.envRaw})`;
  return row.envUrl ?? row.envRaw;
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
          In use:
        </span>{" "}
        <code className="break-all rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[11px]">
          {row.effectiveUrl ?? "not configured"}
        </code>
      </li>
    </ul>
  );
}
