"use client";

import { useState } from "react";
import { SettingsBlock } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiTokenScope } from "@/server/api-token";
import { trpc } from "@/trpc/react";

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Bearer tokens for services that call OwnTube's API on your behalf (the n8n
 * playback mesh). Unlike the TV's device login they never expire, each is
 * limited to its scopes, and revoking one takes effect on the next request.
 * A token is shown once, right after it is created — only its hash is kept.
 */
export function ApiTokensSection() {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [created, setCreated] = useState<{
    label: string;
    token: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  const scopeOptions = trpc.apiTokens.scopes.useQuery();
  const tokens = trpc.apiTokens.list.useQuery();
  const create = trpc.apiTokens.create.useMutation({
    onSuccess: ({ token }) => {
      setCreated({ label: label.trim(), token });
      setCopied(false);
      setLabel("");
      setScopes([]);
      void utils.apiTokens.list.invalidate();
    },
  });
  const revoke = trpc.apiTokens.revoke.useMutation({
    onSuccess: () => {
      setConfirmRevoke(null);
      void utils.apiTokens.list.invalidate();
    },
  });

  const scopeLabel = (key: ApiTokenScope) =>
    scopeOptions.data?.find((s) => s.key === key)?.label ?? key;

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const canCreate =
    label.trim().length > 0 && scopes.length > 0 && !create.isPending;

  return (
    <SettingsBlock>
      <h3 className="text-sm font-medium">API tokens</h3>
      <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        For services that update OwnTube on your behalf, such as the Pocket
        Casts playback sync. Send a token as{" "}
        <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5">
          Authorization: Bearer …
        </code>
        . Tokens don't expire, can only do what their scopes allow, and stop
        working as soon as you revoke them.
      </p>

      {created ? (
        <div className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm">
          <p>
            New token for <strong>{created.label}</strong>. Copy it now — it
            won't be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-[hsl(var(--muted))] px-1.5 py-0.5">
              {created.token}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(created.token)}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCreated(null)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {tokens.data ? (
        tokens.data.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.label}</span>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t.scopes.map(scopeLabel).join(", ")} · created{" "}
                  {formatDate(t.createdAt)} ·{" "}
                  {t.lastUsedAt
                    ? `last used ${formatDate(t.lastUsedAt)}`
                    : "never used"}
                </span>
                {confirmRevoke === t.id ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => revoke.mutate({ id: t.id })}
                      disabled={revoke.isPending}
                    >
                      {revoke.isPending ? "Revoking…" : "Yes, revoke"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRevoke(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRevoke(t.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No API tokens yet.
          </p>
        )
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) create.mutate({ label: label.trim(), scopes });
        }}
      >
        <Input
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder="Name, e.g. n8n playback mesh"
          maxLength={100}
          className="max-w-sm"
        />
        {scopeOptions.data?.map((scope) => (
          <label key={scope.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={scopes.includes(scope.key)}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setScopes((prev) =>
                  checked
                    ? [...prev, scope.key]
                    : prev.filter((s) => s !== scope.key),
                );
              }}
            />
            <span>
              {scope.label}
              <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                {scope.description}
              </span>
            </span>
          </label>
        ))}
        <Button type="submit" variant="outline" size="sm" disabled={!canCreate}>
          {create.isPending ? "Creating…" : "Create token"}
        </Button>
      </form>
    </SettingsBlock>
  );
}
