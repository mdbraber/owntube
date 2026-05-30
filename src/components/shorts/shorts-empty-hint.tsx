import Link from "next/link";
import type { UpstreamAvailability } from "@/server/services/proxy";

type ShortsEmptyHintProps = {
  upstream: UpstreamAvailability;
  signedIn: boolean;
};

export function ShortsEmptyHint({ upstream, signedIn }: ShortsEmptyHintProps) {
  if (!upstream.anyConfigured) {
    return (
      <div className="space-y-2 text-xs text-white/60">
        <p>No Piped or Invidious instance is configured for this server.</p>
        {signedIn ? (
          <p>
            Add instance URLs in{" "}
            <Link
              href="/settings"
              className="text-[hsl(var(--primary))] hover:underline"
            >
              Settings
            </Link>{" "}
            (Video source instances), or ask your admin to set{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
              PIPED_BASE_URL
            </code>{" "}
            /{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
              INVIDIOUS_BASE_URL
            </code>{" "}
            in the server environment.
          </p>
        ) : (
          <p>
            Sign in to override instance URLs in Settings, or configure{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
              PIPED_BASE_URL
            </code>{" "}
            /{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-[11px]">
              INVIDIOUS_BASE_URL
            </code>{" "}
            on the server.
          </p>
        )}
      </div>
    );
  }

  const configured = [
    upstream.pipedConfigured ? "Piped" : null,
    upstream.invidiousConfigured ? "Invidious" : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <div className="space-y-2 text-xs text-white/60">
      <p>
        {configured}{" "}
        {upstream.pipedConfigured && upstream.invidiousConfigured
          ? "are"
          : "is"}{" "}
        configured, but no shorts were returned for your region.
      </p>
      {signedIn ? (
        <p>
          Shorts follow your <strong>trending region</strong> from{" "}
          <Link
            href="/settings"
            className="text-[hsl(var(--primary))] hover:underline"
          >
            Settings
          </Link>{" "}
          (Home / trending region). Change it if you only see content from
          another country. You can also use{" "}
          <strong>Check instances health</strong> there to verify your Piped
          instance.
        </p>
      ) : (
        <p>
          The server instances may be down or rate-limited. Sign in to check
          instance health in Settings or try again later.
        </p>
      )}
    </div>
  );
}
