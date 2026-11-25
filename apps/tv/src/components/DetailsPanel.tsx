import type { VideoDetail } from "@web/server/services/proxy.types";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { formatCompactCount, formatViews, htmlToPlainText } from "@/lib/format";
import { trpc } from "@/lib/trpc-react";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type Tab = "description" | "comments";
type Sort = "top" | "new";

/**
 * The video's description and comments, read-only, beside the paused
 * picture. Text is split into focusable blocks (paragraphs, comments) so the
 * D-pad steps through it and the list follows focus; Back closes.
 */
export function DetailsPanel({
  detail,
  onClose,
}: {
  detail: VideoDetail;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("description");
  const [sort, setSort] = useState<Sort>("top");

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const paragraphs = useMemo(
    () =>
      (detail.description ?? "")
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean),
    [detail.description],
  );

  const comments = trpc.video.comments.useInfiniteQuery(
    { videoId: detail.videoId, sortBy: sort },
    {
      enabled: tab === "comments",
      getNextPageParam: (page) => page.continuation ?? undefined,
    },
  );
  const commentRows = comments.data?.pages.flatMap((p) => p.comments) ?? [];
  const firstPage = comments.data?.pages[0];

  return (
    <View style={styles.scrim}>
      <TVFocusGuideView
        style={styles.panel}
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
      >
        <Text style={styles.title} numberOfLines={2}>
          {detail.title}
        </Text>
        <Text style={styles.meta}>
          {[detail.channelName, formatViews(detail.viewCount)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <View style={styles.tabs}>
          <FocusButton
            label="Description"
            variant={tab === "description" ? "primary" : "ghost"}
            onPress={() => setTab("description")}
            hasTVPreferredFocus
            style={styles.tab}
          />
          <FocusButton
            label="Comments"
            variant={tab === "comments" ? "primary" : "ghost"}
            onPress={() => setTab("comments")}
            style={styles.tab}
          />
          {tab === "comments" ? (
            <FocusButton
              label={sort === "top" ? "Top first" : "Newest first"}
              onPress={() => setSort(sort === "top" ? "new" : "top")}
              style={styles.tab}
            />
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {tab === "description" ? (
            paragraphs.length > 0 ? (
              paragraphs.map((text, index) => (
                // Paragraphs are static text; the index is a stable key.
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                <Block key={index}>
                  <Text style={styles.text}>{text}</Text>
                </Block>
              ))
            ) : (
              <Text style={styles.muted}>No description.</Text>
            )
          ) : comments.isPending ? (
            <ActivityIndicator color={colors.brand} />
          ) : firstPage?.disabled ? (
            <Text style={styles.muted}>Comments are turned off.</Text>
          ) : commentRows.length === 0 ? (
            <Text style={styles.muted}>
              {comments.isError ? "Couldn't load comments." : "No comments."}
            </Text>
          ) : (
            <>
              {firstPage?.commentCount ? (
                <Text style={styles.muted}>
                  {formatCompactCount(firstPage.commentCount)} comments
                </Text>
              ) : null}
              {commentRows.map((comment) => (
                <Block key={comment.commentId}>
                  <Text style={styles.author}>
                    {comment.isPinned ? "📌 " : ""}
                    {comment.author}
                    {comment.publishedText ? (
                      <Text style={styles.muted}>
                        {`  ${comment.publishedText}`}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={styles.text}>
                    {htmlToPlainText(comment.text)}
                  </Text>
                  {comment.likeCount ? (
                    <Text style={styles.muted}>
                      👍 {formatCompactCount(comment.likeCount)}
                      {comment.replyCount
                        ? `  ·  ${comment.replyCount} replies`
                        : ""}
                    </Text>
                  ) : null}
                </Block>
              ))}
              {comments.hasNextPage ? (
                <FocusButton
                  label="More comments"
                  loading={comments.isFetchingNextPage}
                  onPress={() => void comments.fetchNextPage()}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
}

/** A focusable stretch of text, so the D-pad can walk (and scroll) through it. */
function Block({ children }: { children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.block, focused && styles.blockFocused]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    alignItems: "flex-end",
    backgroundColor: colors.overlay,
  },
  panel: {
    width: 620,
    height: "100%",
    paddingVertical: spacing.screen,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.cardElevated,
    borderLeftWidth: 1,
    borderLeftColor: colors.surfaceBorder,
    gap: spacing.sm,
  },
  title: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: "700" },
  meta: { color: colors.mutedForeground, fontSize: fontSize.sm },
  tabs: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm },
  tab: { minHeight: 40, paddingHorizontal: spacing.md },
  body: { gap: spacing.xs, paddingBottom: spacing.xl },
  block: {
    padding: spacing.sm,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
    gap: 4,
  },
  blockFocused: { borderColor: colors.ring, backgroundColor: colors.card },
  text: { color: colors.foreground, fontSize: fontSize.md, lineHeight: 22 },
  author: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
