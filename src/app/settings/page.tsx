import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { TakeoutImportPanel } from "@/components/settings/takeout-import-panel";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/settings");
  }

  const caller = await createCaller();
  const payload = await caller.settings.get();
  const { instanceSources, ...settings } = payload;

  return (
    <main className="ot-page max-w-4xl space-y-8">
      <PageHeader
        title="Settings"
        subtitle="Instance URL, theme, and account preferences."
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/">Home</Link>
        </Button>
      </PageHeader>
      <div className="space-y-8">
        <SettingsPanel
          initial={settings}
          initialInstanceSources={instanceSources}
        />
        <TakeoutImportPanel />
      </div>

      <section className="ot-surface-card space-y-3 p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">
          Recommendations
        </h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Run the taste wizard to set interest keywords and rate sample videos.
          Likes, dislikes, and saves from the rest of the app also shape your
          feed. For a focused view of signals, open Algorithm in the sidebar.
        </p>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/onboarding/taste?manual=1">Refine recommendations</Link>
        </Button>
      </section>
    </main>
  );
}
