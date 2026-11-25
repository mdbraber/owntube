import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { memo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import {
  formatPublishedLabel,
  formatThumbnailBadge,
  formatViews,
} from "@/lib/format";
import { createStyles } from "@/lib/ui-scale";
import { useThumbnail } from "@/lib/use-thumbnail";
import { useWatchProgress } from "@/lib/watch-progress";
import { colors, fontSize, monoFont, radius, spacing } from "@/theme";

// dp, matching the Android TV YouTube app (5.30, Nov 2026): its regular
// shelves and search results measure ~266x150 dp on a 960x540 dp screen,
// a bit over three to a row (only a featured first shelf runs larger).
const THUMBNAIL_WIDTH = 264;
const THUMBNAIL_HEIGHT = 148;
/** The focus outline sits outside the thumbnail, so the card is that much wider. */
const CARD_WIDTH = THUMBNAIL_WIDTH + 2 * 3;

type Props = {
  video: UnifiedVideo;
  onPress: (videoId: string) => void;
  /** Long-press OK: the card's context menu. */
  onLongPress?: (video: UnifiedVideo) => void;
  hasTVPreferredFocus?: boolean;
  /** Position in the parent row, passed back through `onFocusChange`. */
  index?: number;
  /** Lets a parent react to focus, e.g. to scroll the card into view. */
  onFocusChange?: (focused: boolean, index: number) => void;
};

/**
 * Memoized: rows hold dozens of cards, and without it every parent render
 * (a page loading, the player's clock) re-rendered all of them. Parents pass
 * stable callbacks so the props compare equal.
 */
export const VideoCard = memo(function VideoCard({
  video,
  onPress,
  onLongPress,
  hasTVPreferredFocus,
  index = 0,
  onFocusChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const badge = formatThumbnailBadge(video);
  const views = formatViews(video.viewCount);
  const published = formatPublishedLabel(
    video.publishedText,
    video.publishedAt,
  );
  const metadata = [views, published].filter(Boolean).join(" • ");
  const watched = useWatchProgress(video.videoId);
  const thumbnail = useThumbnail(video);

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocusChange?.(true, index);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false, index);
      }}
      onPress={() => onPress(video.videoId)}
      onLongPress={onLongPress ? () => onLongPress(video) : undefined}
      style={styles.card}
    >
      {/* YouTube's focus: a white outline around the thumbnail only, no zoom,
          no overlay; the title below turns white. */}
      <View style={[styles.thumbFrame, focused && styles.thumbFrameFocused]}>
        <View style={styles.thumbWrap}>
          <Image
            source={thumbnail.uri ? { uri: thumbnail.uri } : undefined}
            onError={thumbnail.onError}
            // Finished videos recede, like the web's watched cards; focus
            // brings one back to full strength.
            style={[
              styles.thumb,
              watched?.completed && !focused && styles.thumbWatched,
            ]}
            resizeMode="cover"
            // Decode at view size: Android otherwise keeps the full upstream
            // bitmap (up to 1280x720) per card, which churns memory and GC.
            resizeMethod="resize"
          />
          {watched ? (
            <View style={styles.progressTrack} pointerEvents="none">
              <View
                style={[
                  styles.progressFill,
                  // Finished videos read green, partial ones brand — the same
                  // distinction the web card makes.
                  watched.completed && styles.progressFillComplete,
                  { width: `${watched.fraction * 100}%` },
                ]}
              />
            </View>
          ) : null}
          {badge ? (
            <View
              style={[
                styles.badge,
                video.isLive && styles.liveBadge,
                video.isUpcoming && styles.upcomingBadge,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  video.isUpcoming && styles.upcomingBadgeText,
                ]}
              >
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.copy}>
        <Text
          style={[styles.title, focused && styles.titleFocused]}
          numberOfLines={2}
        >
          {video.title}
        </Text>
        {video.channelName ? (
          <Text style={styles.channel} numberOfLines={1}>
            {video.channelName}
          </Text>
        ) : null}
        {metadata ? (
          <Text style={styles.metadata} numberOfLines={1}>
            {metadata}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

export const VIDEO_CARD_WIDTH = CARD_WIDTH;

const styles = createStyles({
  card: { width: CARD_WIDTH },
  thumbFrame: {
    borderRadius: radius.card + 3,
    borderWidth: 3,
    borderColor: "transparent",
  },
  thumbFrameFocused: { borderColor: colors.ring },
  thumbWrap: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: colors.muted,
  },
  thumb: { width: "100%", height: "100%" },
  thumbWatched: { opacity: 0.45 },
  // Sits on the thumbnail's bottom edge, like the web app's watched bar.
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: colors.progressTrack,
  },
  progressFill: { height: "100%", backgroundColor: colors.brand },
  progressFillComplete: { backgroundColor: colors.success },
  badge: {
    position: "absolute",
    right: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: colors.durationBadge,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveBadge: { backgroundColor: colors.brand },
  upcomingBadge: { backgroundColor: colors.foreground },
  badgeText: {
    color: colors.foreground,
    fontSize: 12,
    fontFamily: monoFont,
    fontWeight: "600",
  },
  upcomingBadgeText: { color: colors.background },
  copy: { marginTop: spacing.sm, paddingHorizontal: 3, minWidth: 0 },
  // ~18dp titles, white only on the focused card; grey metadata below.
  title: {
    color: colors.cardTitle,
    fontSize: fontSize.base,
    fontWeight: "600",
    lineHeight: 20,
  },
  titleFocused: { color: colors.foreground },
  channel: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  metadata: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
});
