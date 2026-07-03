import type { Metadata } from "next";
import { TvPairingPanel } from "@/components/auth/tv-pairing-panel";
import { auth } from "@/server/auth";
import { normalizeDevicePairingUserCode } from "@/server/device-pairing";

type TvPairPageProps = {
  searchParams: Promise<{
    code?: string | string[];
  }>;
};

export const metadata: Metadata = {
  title: "Connect TV",
};

function firstSearchParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

export default async function TvPairPage({ searchParams }: TvPairPageProps) {
  const sp = await searchParams;
  const userCode = normalizeDevicePairingUserCode(firstSearchParam(sp.code));
  const session = await auth();
  const isLoggedIn = Boolean(session?.user?.id);
  const pairPath = `/tv/pair?code=${encodeURIComponent(userCode)}`;
  const loginHref = `/login?callbackUrl=${encodeURIComponent(pairPath)}`;

  return (
    <main className="ot-page">
      {userCode ? (
        <TvPairingPanel
          isLoggedIn={isLoggedIn}
          loginHref={loginHref}
          userCode={userCode}
        />
      ) : (
        <div className="mx-auto w-full max-w-md rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
          <h1 className="text-xl font-semibold">Invalid pairing link</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Request a new QR code on the TV.
          </p>
        </div>
      )}
    </main>
  );
}
