import type { UnifiedVideo } from "@web/server/services/proxy.types";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Text, View } from "react-native";
import { type MenuItem, MenuPanel } from "@/components/MenuPanel";
import { loadHints, markLongPressUsed, takeLongPressHint } from "@/lib/hints";
import type { Nav } from "@/lib/navigation";
import { usePlaylistMenu } from "@/lib/playlist-menu";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { createStyles } from "@/lib/ui-scale";
import { colors, fontSize, radius, spacing } from "@/theme";

/** Screen-specific actions (Move up, Remove from history…), listed first. */
export type CardMenuExtras = (video: UnifiedVideo) => MenuItem[];

type CardMenuApi = {
  open: (video: UnifiedVideo, extras?: MenuItem[]) => void;
  /** A short confirmation at the top right ("Added to queue"). */
  notify: (text: string) => void;
  /** A card took focus: say how to open its menu, the first few times. */
  hintLongPress: () => void;
};

const CardMenuContext = createContext<CardMenuApi>({
  open: () => {},
  notify: () => {},
  hintLongPress: () => {},
});

export function useCardMenu(): CardMenuApi {
  return useContext(CardMenuContext);
}

/**
 * The one context menu every video card shares: long-press OK on a card opens
 * it. Play, queue, save, playlists, watched, the two recommendation opt-outs
 * and the channel, plus whatever the screen adds (reordering on the queue,
 * removing from history).
 */
export function CardMenuProvider({
  nav,
  children,
}: {
  nav: Nav;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<{
    video: UnifiedVideo;
    extras: MenuItem[];
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const close = useCallback(() => setTarget(null), []);
  useEffect(() => {
    void loadHints();
  }, []);
  const api = useMemo<CardMenuApi>(
    () => ({
      open: (video, extras = []) => {
        markLongPressUsed();
        setTarget({ video, extras });
      },
      notify,
      hintLongPress: () => {
        if (takeLongPressHint()) notify("Tip: hold OK on a video for options");
      },
    }),
    [notify],
  );

  return (
    <CardMenuContext.Provider value={api}>
      {children}
      {target ? (
        <CardMenuPanel
          video={target.video}
          extras={target.extras}
          nav={nav}
          notify={notify}
          onClose={close}
        />
      ) : null}
      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </CardMenuContext.Provider>
  );
}

function CardMenuPanel({
  video,
  extras,
  nav,
  notify,
  onClose,
}: {
  video: UnifiedVideo;
  extras: MenuItem[];
  nav: Nav;
  notify: (text: string) => void;
  onClose: () => void;
}) {
  const { videoId, channelId } = video;
  const queue = trpc.queue.list.useQuery();
  const state = trpc.interactions.state.useQuery({ videoId });
  const queued = (queue.data ?? []).some((row) => row.videoId === videoId);
  const saved = state.data?.save ?? false;
  const playlistMenu = usePlaylistMenu({
    video,
    enabled: true,
    notify,
    onCreated: onClose,
  });

  /** Runs a mutation, confirms it, refreshes the lists it touches, closes. */
  const act = (
    call: () => Promise<unknown>,
    done: string,
    refresh: unknown[][] = [],
  ) => {
    onClose();
    call()
      .then(() => {
        notify(done);
        for (const queryKey of refresh) {
          void queryClient.invalidateQueries({ queryKey });
        }
      })
      .catch(() => notify("That didn't work — try again"));
  };

  const buildPage = (key: string) => {
    const shared = playlistMenu.buildPage(key);
    if (shared) return shared;
    const items: MenuItem[] = [
      // Screen actions act and close, like the built-in ones below.
      ...extras.map((item) => ({
        ...item,
        onPress: () => {
          onClose();
          item.onPress?.();
        },
      })),
      {
        key: "play",
        label: "Play",
        onPress: () => {
          onClose();
          nav.openVideo(videoId);
        },
      },
      queued
        ? {
            key: "queue",
            label: "Remove from queue",
            onPress: () =>
              act(
                () => trpcClient.queue.remove.mutate({ videoId }),
                "Removed from queue",
                [["feed", "queue.listDetailed"], [["queue"]]],
              ),
          }
        : {
            key: "queue",
            label: "Add to queue",
            onPress: () =>
              act(
                () =>
                  trpcClient.queue.add.mutate({
                    videoId,
                    title: video.title,
                    channelId,
                  }),
                "Added to queue",
                [["feed", "queue.listDetailed"], [["queue"]]],
              ),
          },
      {
        key: "save",
        label: saved ? "Remove from Saved" : "Save",
        onPress: () =>
          act(
            () =>
              trpcClient.interactions.set.mutate({
                videoId,
                channelId,
                type: "save",
                active: !saved,
                title: video.title,
              }),
            saved ? "Removed from Saved" : "Saved",
            [["feed", "interactions.listSaved"], [["interactions"]]],
          ),
      },
      { key: "playlists", label: "Save to playlist", submenu: "playlists" },
      {
        key: "watched",
        label: "Mark as watched",
        onPress: () =>
          act(
            () =>
              trpcClient.subscriptions.markWatched.mutate({
                videoId,
                channelId,
              }),
            "Marked as watched",
            [[["history"]]],
          ),
      },
      {
        key: "ignore",
        label: "Not interested",
        onPress: () =>
          act(
            () =>
              trpcClient.interactions.set.mutate({
                videoId,
                channelId,
                type: "ignore",
                active: true,
                title: video.title,
              }),
            "Got it — you'll see less like this",
            [["feed"]],
          ),
      },
      ...(channelId
        ? [
            {
              key: "block",
              label: "Don't recommend channel",
              onPress: () =>
                act(
                  () =>
                    trpcClient.interactions.blockRecommendationChannel.mutate({
                      channelId,
                    }),
                  `Won't recommend ${video.channelName ?? "this channel"}`,
                  [["feed"]],
                ),
            },
            {
              key: "channel",
              label: `Go to ${video.channelName ?? "channel"}`,
              onPress: () => {
                onClose();
                nav.openChannel(channelId);
              },
            },
          ]
        : []),
    ];
    return { title: video.title, items };
  };

  return <MenuPanel buildPage={buildPage} onClose={onClose} />;
}

const styles = createStyles({
  toast: {
    position: "absolute",
    top: 36,
    right: 36,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    borderRadius: radius.shell,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toastText: { color: colors.foreground, fontSize: fontSize.md },
});
