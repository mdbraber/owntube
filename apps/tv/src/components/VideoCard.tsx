import { Feather } from "@expo/vector-icons";
import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  channelInitial,
  formatPublishedLabel,
  formatThumbnailBadge,
  formatViews,
} from "@/lib/format";
import { useWatchedFraction } from "@/lib/watch-progress";
import { colors, focus, fontSize, monoFont, radius, spacing } from "@/theme";

// dp, matching the Android TV YouTube app: its 528x297 physical-pixel
// thumbnails are 264x148 dp on a density-2 panel.
const CARD_WIDTH = 280;
const THUMBNAIL_WIDTH = 264;
const THUMBNAIL_HEIGHT = 148;

type Props = {
  video: UnifiedVideo;
  onPress: (videoId: string) => void;
  hasTVPreferredFocus?: boolean;
  /** Lets a parent react to focus, e.g. to scroll the card into view. */
  onFocusChange?: (focused: boolean) => void;
};

export function VideoCard({
  video,
  onPress,
  hasTVPreferredFocus,
  onFocusChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const badge = formatThumbnailBadge(video);
  const views = formatViews(video.viewCount);
  const published = formatPublishedLabel(
    video.publishedText,
    video.publishedAt,
  );
  const metadata = [views, published].filter(Boolean).join(" - ");
  const watched = useWatchedFraction(video.videoId);

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false);
      }}
      onPress={() => onPress(video.videoId)}
      style={[styles.card, focused && styles.cardFocused]}
    >
      <View style={styles.thumbWrap}>
        {video.thumbnailUrl ? (
          <Image
            source={{ uri: video.thumbnailUrl }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
        {focused ? (
          <View style={styles.playOverlay} pointerEvents="none">
            <View style={styles.playBubble}>
              <Feather name="play" size={26} color={colors.primaryForeground} />
            </View>
          </View>
        ) : null}
        {watched > 0 ? (
          <View style={styles.progressTrack} pointerEvents="none">
            <View
              style={[styles.progressFill, { width: `${watched * 100}%` }]}
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
      <View style={styles.metaRow}>
        <ChannelAvatar
          imageUrl={video.channelAvatarUrl}
          channelName={video.channelName}
        />
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
      </View>
    </Pressable>
  );
}

function ChannelAvatar({
  imageUrl,
  channelName,
}: {
  imageUrl?: string;
  channelName?: string;
}) {
  if (imageUrl) {
    return <Image source={{ uri: imageUrl }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{channelInitial(channelName)}</Text>
    </View>
  );
}

export const VIDEO_CARD_WIDTH = CARD_WIDTH;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    padding: 8,
    borderRadius: radius.card,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  cardFocused: {
    backgroundColor: colors.card,
    borderColor: colors.ring,
    shadowColor: colors.brand,
    shadowOpacity: focus.shadowOpacity,
    shadowRadius: focus.shadowRadius,
    shadowOffset: focus.shadowOffset,
    elevation: focus.elevation,
    transform: [{ scale: focus.scale }],
  },
  thumbWrap: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderRadius: radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.muted,
  },
  thumb: { width: "100%", height: "100%" },
  thumbPlaceholder: { backgroundColor: colors.muted },
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
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  playBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
  },
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
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.avatarFallback,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  avatarInitial: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  copy: { flex: 1, minWidth: 0 },
  title: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "600",
    lineHeight: 18,
  },
  titleFocused: { color: colors.primary },
  channel: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  metadata: {
    color: colors.mutedForeground,
    fontSize: 14,
    marginTop: 2,
  },
});
