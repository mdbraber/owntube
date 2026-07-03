"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/trpc/react";

type TvPairingPanelProps = {
  isLoggedIn: boolean;
  loginHref: string;
  userCode: string;
};

export function TvPairingPanel({
  isLoggedIn,
  loginHref,
  userCode,
}: TvPairingPanelProps) {
  const [approved, setApproved] = useState(false);
  const approveMutation = trpc.auth.approveDevicePairing.useMutation({
    onSuccess: (result) => {
      setApproved(result.status === "approved");
    },
  });

  const approve = () => {
    approveMutation.mutate({ userCode });
  };

  const isExpired =
    approveMutation.data?.status === "expired" ||
    approveMutation.error?.data?.code === "BAD_REQUEST";

  return (
    <Card className="ot-surface-card mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Connect TV</CardTitle>
        <CardDescription>
          Pair this TV with your owntube account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-[var(--radius-shell)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.45)] p-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            TV code
          </p>
          <p className="ot-mono-data mt-1 text-2xl font-semibold text-[hsl(var(--foreground))]">
            {userCode}
          </p>
        </div>

        {!isLoggedIn ? (
          <Button asChild className="w-full">
            <Link href={loginHref}>Sign in to connect</Link>
          </Button>
        ) : approved ? (
          <p className="rounded-[var(--radius-shell)] border border-[hsl(var(--primary)_/_0.35)] bg-[hsl(var(--primary)_/_0.12)] p-3 text-sm text-[hsl(var(--foreground))]">
            TV connected. You can return to the TV.
          </p>
        ) : isExpired ? (
          <p className="rounded-[var(--radius-shell)] border border-[hsl(var(--destructive)_/_0.35)] bg-[hsl(var(--destructive)_/_0.12)] p-3 text-sm text-[hsl(var(--foreground))]">
            This code expired. Request a new code on the TV.
          </p>
        ) : (
          <>
            <Button
              className="w-full"
              disabled={approveMutation.isPending}
              onClick={approve}
              type="button"
            >
              {approveMutation.isPending ? "Connecting..." : "Connect TV"}
            </Button>
            {approveMutation.error ? (
              <p className="text-sm text-[hsl(var(--destructive))]">
                Could not connect this TV.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
