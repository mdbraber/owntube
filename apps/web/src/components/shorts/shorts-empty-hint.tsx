import Link from "next/link";

type ShortsEmptyHintProps = {
  signedIn: boolean;
};

export function ShortsEmptyHint({ signedIn }: ShortsEmptyHintProps) {
  return (
    <div className="space-y-2 text-xs text-white/60">
      <p>YouTube returned no shorts right now.</p>
      {signedIn ? (
        <p>
          Shorts follow your <strong>region</strong> from{" "}
          <Link
            href="/settings"
            className="text-[hsl(var(--primary))] hover:underline"
          >
            Settings
          </Link>
          . Change it if you only see content from another country, or try again
          later.
        </p>
      ) : (
        <p>Try again later.</p>
      )}
    </div>
  );
}
