import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LibrarySearchResults } from "@/components/search/library-search-results";
import { SearchResults } from "@/components/search/search-results";
import { hasLibraryFilter } from "@/lib/library-query";
import { appPathFromYoutubeUrl } from "@/lib/youtube-url";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    sort?: string | string[];
    page?: string | string[];
  }>;
};

function pageOf(raw: string | string[] | undefined): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
}

/** Plain queries search YouTube; `in:`/`tag:`/`has:` filters the library. */
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
  // A YouTube link searched for from anywhere opens its OwnTube page.
  const appPath = appPathFromYoutubeUrl(q);
  if (appPath) {
    redirect(appPath);
  }

  return (
    <main className="ot-page flex min-h-0 flex-1 flex-col gap-6 pt-1">
      <Suspense
        fallback={
          <p className="text-[hsl(var(--muted-foreground))]">Loading…</p>
        }
      >
        {hasLibraryFilter(q) ? (
          <LibrarySearchResults query={q} page={pageOf(sp.page)} />
        ) : (
          <SearchResults query={q} sort={sort} />
        )}
      </Suspense>
    </main>
  );
}
