import { Stack } from "expo-router";
import { useState } from "react";
import { WebScreen } from "@/components/web-screen";

/**
 * The system search tab: a native search field in the navigation bar, results
 * from the web search page (which also understands pasted YouTube links).
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("");
  return (
    <>
      <Stack.SearchBar
        placeholder="Search videos and channels"
        onSearchButtonPress={(event) => setQuery(event.nativeEvent.text.trim())}
      />
      <WebScreen
        path={query ? `/search?q=${encodeURIComponent(query)}` : "/search"}
        title="Search"
      />
    </>
  );
}
