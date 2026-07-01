import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TasteOnboardingClient } from "@/components/onboarding/taste-onboarding-client";
import { auth } from "@/server/auth";

export default async function TasteOnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboarding/taste");
  }

  return (
    <main className="ot-page max-w-2xl">
      <Suspense
        fallback={
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Loading…
          </p>
        }
      >
        <TasteOnboardingClient />
      </Suspense>
    </main>
  );
}
