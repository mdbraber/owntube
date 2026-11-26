import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/settings");
  }

  const caller = await createCaller();
  const settings = await caller.settings.get();

  return (
    <main className="ot-page">
      {/* The width lives on an inner box: .ot-page sets its own max-width,
          which outranks a max-w-* utility on the same element. */}
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Settings" />
        <SettingsPanel initial={settings} />
      </div>
    </main>
  );
}
