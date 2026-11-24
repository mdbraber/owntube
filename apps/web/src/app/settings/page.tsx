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
  const { instanceSources, ...settings } = await caller.settings.get();

  return (
    <main className="ot-page max-w-3xl">
      <PageHeader title="Settings" />
      <SettingsPanel
        initial={settings}
        initialInstanceSources={instanceSources}
      />
    </main>
  );
}
