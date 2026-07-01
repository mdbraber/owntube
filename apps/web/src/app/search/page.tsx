import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SearchResults } from "@/components/search/search-results";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    sort?: string | string[];
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const raw = sp.q;
  const q = typeof raw === "string" ? raw.trim() : "";
  const sortRaw = sp.sort;
  const sort =
    typeof sortRaw === "string" &&
    (sortRaw === "relevance" || sortRaw === "newest" || sortRaw === "views")
      ? sortRaw
      : "relevance";
  if (!q) {
    redirect("/");
  }

  return (
    <main className="ot-page flex min-h-0 flex-1 flex-col gap-6 pt-1">
      <Suspense
        fallback={
          <p className="text-[hsl(var(--muted-foreground))]">Loading…</p>
        }
      >
        <SearchResults query={q} sort={sort} />
      </Suspense>
    </main>
  );
}
