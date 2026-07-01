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
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type HomeHeroProps = {
  video: UnifiedVideo;
  label: string;
  onPress: (videoId: string) => void;
};

export function HomeHero({ video, label, onPress }: HomeHeroProps) {
  const [focused, setFocused] = useState(false);
  const badge = formatThumbnailBadge(video);
  const views = formatViews(video.viewCount);
  const published = formatPublishedLabel(
    video.publishedText,
    video.publishedAt,
  );
  const metadata = [views, published].filter(Boolean).join(" - ");

  return (
    <Pressable
      hasTVPreferredFocus
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onPress(video.videoId)}
      style={[styles.hero, focused && styles.heroFocused]}
    >
      {video.thumbnailUrl ? (
        <Image
          source={{ uri: video.thumbnailUrl }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.image, styles.placeholder]} />
      )}
      <View style={styles.scrimFull} />
      <View style={styles.content}>
        <View style={styles.pill}>
          <View style={styles.pillDot} />
          <Text style={styles.pillText}>{label}</Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {video.title}
        </Text>

        <View style={styles.metaRow}>
          <ChannelAvatar
            imageUrl={video.channelAvatarUrl}
            channelName={video.channelName}
          />
          <View style={styles.metaCopy}>
            <Text style={styles.channel} numberOfLines={1}>
              {video.channelName ?? "Channel"}
            </Text>
            <Text style={styles.metadata} numberOfLines={1}>
              {[metadata, badge].filter(Boolean).join(" - ")}
            </Text>
          </View>
        </View>

        <View style={[styles.playButton, focused && styles.playButtonFocused]}>
          <Feather name="play" size={22} color={colors.background} />
          <Text style={styles.playText}>Play now</Text>
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

const styles = StyleSheet.create({
  hero: {
    height: 280,
    borderRadius: radius.hero,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
    overflow: "hidden",
    backgroundColor: colors.muted,
  },
  heroFocused: {
    borderColor: colors.ring,
    shadowColor: colors.brand,
    shadowOpacity: focus.shadowOpacity,
    shadowRadius: focus.shadowRadius,
    shadowOffset: focus.shadowOffset,
    elevation: focus.elevation,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  placeholder: { backgroundColor: colors.muted },
  scrimFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.heroScrimSoft,
  },
  content: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    maxWidth: 580,
  },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 4,
    marginBottom: spacing.md,
  },
  pillDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  pillText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "800",
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "800",
    lineHeight: 34,
    maxWidth: 580,
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
    fontSize: fontSize.base,
    fontWeight: "800",
  },
  metaCopy: { flex: 1, minWidth: 0 },
  channel: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: "700",
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  metadata: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  playButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.shell,
    backgroundColor: colors.foreground,
  },
  playButtonFocused: {
    backgroundColor: colors.primaryForeground,
  },
  playText: {
    color: colors.background,
    fontSize: fontSize.md,
    fontWeight: "800",
  },
});
