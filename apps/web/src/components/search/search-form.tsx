import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchFormProps = {
  defaultQuery?: string;
};

export function SearchForm({ defaultQuery = "" }: SearchFormProps) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row sm:items-center">
      <form
        action="/search"
        method="get"
        aria-label="Search videos"
        className="flex w-full flex-1 flex-col gap-2 sm:flex-row sm:items-center"
      >
        <label className="sr-only" htmlFor="search-query">
          Search videos
        </label>
        <Input
          id="search-query"
          name="q"
          type="search"
          placeholder="Search videos…"
          defaultValue={defaultQuery}
          autoComplete="off"
          className="flex-1"
          enterKeyHint="search"
        />
        <Button type="submit" className="shrink-0">
          Search
        </Button>
      </form>
      <Button variant="outline" asChild className="shrink-0">
        <Link href="/">Home</Link>
      </Button>
    </div>
  );
}
