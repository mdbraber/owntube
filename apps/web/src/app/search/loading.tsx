import { SearchForm } from "@/components/search/search-form";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <SearchForm />
      </header>
      <div className="ot-video-grid">
        {(["a", "b", "c", "d", "e", "f"] as const).map((id) => (
          <div
            key={id}
            className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-md shadow-black/[0.04] dark:shadow-black/30"
          >
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-2 border-t border-[hsl(var(--border)_/_0.65)] p-3.5 pt-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
