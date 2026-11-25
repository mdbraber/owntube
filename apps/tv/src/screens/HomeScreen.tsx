import { Fragment } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { LOGO_WORDMARK } from "@/assets";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { FocusButton } from "@/components/FocusButton";
import { type HomeBlock, HomeBlockRow } from "@/components/HomeBlockRow";
import { SearchBar } from "@/components/SearchBar";
import { SkeletonRows } from "@/components/Skeleton";
import { VideoRow } from "@/components/VideoRow";
import { errorMessage } from "@/lib/error-message";
import type { Nav } from "@/lib/navigation";
import { useRowScroll } from "@/lib/row-scroll";
import { useScreenActive } from "@/lib/screen-active";
import { trpc } from "@/lib/trpc-react";
import { createStyles } from "@/lib/ui-scale";
import { colors, fontSize, spacing } from "@/theme";

/**
 * Home, laid out like the Android TV YouTube app: a pinned header (search,
 * wordmark), then rows: the top recommendations, Continue watching, and the
 * blocks the user arranged on the web (`settings.homeBlocks`). A row slides
 * up under the header when one of its cards takes focus.
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

  const topVideos = top.data?.videos ?? [];
  const personalized =
    top.data?.kind === "personalized" && top.data.coldStart !== true;
  const blocks = settings.data?.homeBlocks ?? [];

  const { scrollRef, onRowLayout, onHeaderLayout, scrollToRow, scrollToTop } =
    useRowScroll();

  const loading = !settings.data && (settings.isPending || top.isPending);

  // The search bar is the ScrollView's first child rather than a sibling above
  // it: Android's ScrollView swallows Up at its top edge, so a bar outside it
  // could never take focus from the first row.
  // Pinned while the rows scroll under it, as in the YouTube app: the round
  // mic and short search pill on the left, the wordmark on the right.
  // The row sits in an inner View: a sticky header's own style moves to the
  // wrapper ScrollView puts around it, and the child gets `flex: 1` instead.
  const searchBar = (
    <View style={styles.headerShell} onLayout={onHeaderLayout}>
      <View style={styles.header}>
        <SearchBar
          onPress={nav.openSearch}
          onFocusChange={(f) => f && scrollToTop()}
        />
        <Image
          source={LOGO_WORDMARK}
          style={styles.wordmark}
          resizeMode="contain"
        />
      </View>
    </View>
  );

  const leadBlock = blocks.find((b) => b.type === "subscriptions");
  const topRow = (preferFirstFocus: boolean) =>
    topVideos.length > 0 ? (
      <View onLayout={(e) => onRowLayout("top", e)}>
        <VideoRow
          title={personalized ? "Top picks for you" : "Trending now"}
          videos={topVideos}
          preferFirstFocus={preferFirstFocus}
          onSelect={(videoId) =>
            nav.openVideo(videoId, {
              context: { source: "feed", videos: topVideos },
            })
          }
          onCardFocusChange={(focused) => focused && scrollToRow("top")}
        />
      </View>
    ) : null;
  const blockRow = (block: HomeBlock, preferFirstFocus: boolean) => (
    <View key={block.id} onLayout={(e) => onRowLayout(block.id, e)}>
      <HomeBlockRow
        block={block}
        region={region}
        nav={nav}
        preferFirstFocus={preferFirstFocus}
        onCardFocusChange={(focused) => focused && scrollToRow(block.id)}
      />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.content}>
        {searchBar}
        <SkeletonRows rows={2} />
      </View>
    );
  }

  // Neither the rows nor the top picks came back: say so, instead of a blank page
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
      stickyHeaderIndices={[0]}
    >
      {searchBar}
      {/* The YouTube app has no hero: its rows start right under the header.
          Subscriptions lead when the user has that block, focused on
          arrival, and Top picks take its place further down; otherwise Top
          picks lead. */}
      {leadBlock ? blockRow(leadBlock, true) : topRow(true)}
      <View onLayout={(e) => onRowLayout("continue", e)}>
        <ContinueWatchingRow
          nav={nav}
          onCardFocusChange={(focused) => focused && scrollToRow("continue")}
        />
      </View>
      {blocks.map((block: HomeBlock) =>
        block === leadBlock ? (
          <Fragment key="top">{topRow(false)}</Fragment>
        ) : (
          blockRow(block, false)
        ),
      )}
      <Text style={styles.hint}>
        Rearrange these rows in Settings → Home rows, or on the web.
      </Text>
    </ScrollView>
  );
}

const styles = createStyles({
  content: {
    gap: spacing.xl,
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: spacing.screen,
  },
  hint: { color: colors.mutedForeground, fontSize: fontSize.sm },
  // Opaque: rows scroll under the pinned header.
  headerShell: { backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  wordmark: { width: 150, height: 34 },
  error: { gap: spacing.md, alignItems: "flex-start" },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  retry: { minWidth: 160 },
});
