import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { FocusButton } from "@/components/FocusButton";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

/** Full-text search via the on-screen TV keyboard. */
export function SearchScreen({ nav }: { nav: Nav }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  const feed = useInfiniteFeed<string>(
    (continuation) =>
      query
        ? trpcClient.search.videos
            .query({ q: query, continuation })
            .then((r) => ({
              items: r.videos,
              next: r.continuation ?? undefined,
            }))
        : Promise.resolve({ items: [], next: undefined }),
    [query],
  );

  const submit = () => setQuery(text.trim());

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.searchSurface,
          inputFocused && styles.searchSurfaceFocused,
        ]}
      >
        <Feather name="search" size={28} color={colors.mutedForeground} />
        <TextInput
          style={styles.input}
          placeholder="Search"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          value={text}
          onChangeText={setText}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onSubmitEditing={submit}
          returnKeyType="search"
          hasTVPreferredFocus
        />
        <FocusButton
          label="Search"
          variant="primary"
          onPress={submit}
          style={styles.searchButton}
        />
      </View>
      <View style={styles.results}>
        <CarouselFeed
          feed={feed}
          onSelect={(videoId) => nav.openVideo(videoId)}
          emptyText={query ? "No results." : "Type a query and press Search."}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg },
  searchSurface: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 72,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: radius.shell,
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  searchSurfaceFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.surfaceStrong,
    shadowColor: colors.brand,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  input: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.lg,
    paddingVertical: spacing.md,
  },
  searchButton: { width: 156 },
  results: { flex: 1 },
});
