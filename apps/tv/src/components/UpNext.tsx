import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useThumbnail } from "@/lib/use-thumbnail";
import { colors, fontSize, radius, spacing } from "@/theme";

/** Seconds the card counts down before playing the next video by itself. */
export const UP_NEXT_COUNTDOWN_SECONDS = 10;

type Props = {
  video: UnifiedVideo;
  /** "Queue", a playlist name… — omitted for related videos. */
  contextLabel?: string;
  /** Counts down and then plays when on; otherwise waits for OK. */
  autoplay: boolean;
  onPlay: () => void;
  onCancel: () => void;
};

/**
 * End-of-video card: what plays next, with "Play now" focused so a single OK
 * continues. With autoplay on it plays by itself after a countdown, like the
 * YouTube TV app; with it off it waits.
 */
export function UpNext({
  video,
  contextLabel,
  autoplay,
  onPlay,
  onCancel,
}: Props) {
  const [remaining, setRemaining] = useState(UP_NEXT_COUNTDOWN_SECONDS);
  const thumbnail = useThumbnail(video);

  useEffect(() => {
    if (!autoplay) return;
    if (remaining <= 0) {
      onPlay();
      return;
    }
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [autoplay, remaining, onPlay]);

  return (
    <View style={styles.scrim}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>
          {contextLabel ? `Up next in ${contextLabel}` : "Up next"}
          {autoplay ? ` · playing in ${remaining}` : ""}
        </Text>
        <View style={styles.body}>
          <Image
            source={thumbnail.uri ? { uri: thumbnail.uri } : undefined}
            style={styles.thumb}
            resizeMethod="resize"
            onError={thumbnail.onError}
          />
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={3}>
              {video.title}
            </Text>
            {video.channelName ? (
              <Text style={styles.channel} numberOfLines={1}>
                {video.channelName}
              </Text>
            ) : null}
          </View>
        </View>
        {/* Both plain: a primary fill would stay red with focus on Cancel. */}
        <View style={styles.buttons}>
          <FocusButton label="Play now" onPress={onPlay} hasTVPreferredFocus />
          <FocusButton label="Cancel" onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

const THUMB_WIDTH = 256;

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.screen,
  },
  card: {
    width: 560,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  eyebrow: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  body: { flexDirection: "row", gap: spacing.md },
  thumb: {
    width: THUMB_WIDTH,
    height: (THUMB_WIDTH * 9) / 16,
    borderRadius: radius.shell,
    backgroundColor: colors.muted,
  },
  copy: { flex: 1, gap: spacing.xs },
  title: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  channel: { color: colors.mutedForeground, fontSize: fontSize.sm },
  buttons: { flexDirection: "row", gap: spacing.md },
});
