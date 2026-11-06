import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { FocusButton } from "@/components/FocusButton";
import { type HomeBlock, HomeBlockRow } from "@/components/HomeBlockRow";
import { HomeHero } from "@/components/HomeHero";
import { SearchBar } from "@/components/SearchBar";
import { SkeletonRows } from "@/components/Skeleton";
import { errorMessage } from "@/lib/error-message";
import type { Nav } from "@/lib/navigation";
import { useRowScroll } from "@/lib/row-scroll";
import { useScreenActive } from "@/lib/screen-active";
import { trpc } from "@/lib/trpc-react";
import { colors, fontSize, spacing } from "@/theme";

/**
 * Home: a search bar and the TV's own hero (the top recommendation) above
 * Continue watching and the blocks the user arranged on the web
 * (`settings.homeBlocks`), one row each. A row takes the top of the scroll
 * area when one of its cards is focused; moving up past the first row brings
 * the hero and the search bar back into view.
 */
export function HomeScreen({ nav }: { nav: Nav }) {
  // Kept mounted while hidden: stop listening, refetch stale data on return.
  const subscribed = useScreenActive();
  const settings = trpc.settings.get.useQuery(undefined, { subscribed });
  const region = settings.data?.trendingRegion ?? "US";
  const top = trpc.feed.home.useQuery(
    { page: 1, pageSize: 12, region },
    { subscribed },
  );

  const heroVideo = top.data?.videos[0];
  const personalized =
    top.data?.kind === "personalized" && top.data.coldStart !== true;
  const blocks = settings.data?.homeBlocks ?? [];

  const { scrollRef, onRowLayout, scrollToRow, scrollToTop } = useRowScroll();

  const loading = !settings.data && (settings.isPending || top.isPending);

  // The search bar is the ScrollView's first child rather than a sibling above
  // it: Android's ScrollView swallows Up at its top edge, so a bar outside it
  // could never take focus from the hero.
  const searchBar = (
    <SearchBar
      onPress={nav.openSearch}
      onFocusChange={(f) => f && scrollToTop()}
    />
  );

  if (loading) {
    return (
      <View style={styles.content}>
        {searchBar}
        <SkeletonRows rows={2} />
      </View>
    );
  }

  // Neither the rows nor the hero came back: say so, instead of a blank page
  // under the search bar with only the "Rearrange these rows" hint.
  if (!settings.data && !top.data && settings.isError) {
    return (
      <View style={styles.content}>
        {searchBar}
        <View style={styles.error}>
          <Text style={styles.errorTitle}>Home didn't load</Text>
          <Text style={styles.hint}>{errorMessage(settings.error)}</Text>
          <FocusButton
            label="Retry"
            variant="primary"
            loading={settings.isFetching || top.isFetching}
            onPress={() => {
              void settings.refetch();
              void top.refetch();
            }}
            style={styles.retry}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {searchBar}
      {heroVideo ? (
        <HomeHero
          video={heroVideo}
          label={personalized ? "Top pick for you" : "Trending now"}
          onPress={(videoId) =>
            nav.openVideo(videoId, {
              context: { source: "feed", videos: top.data?.videos ?? [] },
            })
          }
        />
      ) : null}
      <View onLayout={(e) => onRowLayout("continue", e)}>
        <ContinueWatchingRow
          nav={nav}
          onCardFocusChange={(focused) => focused && scrollToRow("continue")}
        />
      </View>
      {blocks.map((block: HomeBlock) => (
        <View key={block.id} onLayout={(e) => onRowLayout(block.id, e)}>
          <HomeBlockRow
            block={block}
            region={region}
            nav={nav}
            onCardFocusChange={(focused) => focused && scrollToRow(block.id)}
          />
        </View>
      ))}
      <Text style={styles.hint}>
        Rearrange these rows in Settings → Home rows, or on the web.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: spacing.screen,
  },
  hint: { color: colors.mutedForeground, fontSize: fontSize.sm },
  error: { gap: spacing.md, alignItems: "flex-start" },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  retry: { minWidth: 160 },
});
