import { Feather } from "@expo/vector-icons";
import type { UnifiedVideo } from "@web/server/services/proxy.types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type FlatList,
  Pressable,
  Text,
  View,
  type ViewInstance,
} from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { type ChannelTileData, ChannelTiles } from "@/components/ChannelTiles";
import { LetterKeyboard } from "@/components/LetterKeyboard";
import { VideoRow } from "@/components/VideoRow";
import type { Nav } from "@/lib/navigation";
import { loadRecentSearches, rememberSearch } from "@/lib/recent-searches";
import { useActiveBackHandler } from "@/lib/screen-active";
import { speechRecognition, useSpeechRecognitionEvent } from "@/lib/speech";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { type TVFocusGuide, TVFocusGuideView } from "@/lib/tv-focus";
import { createStyles, s } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, focus, fontSize, spacing } from "@/theme";

/** How long typing has to pause before the results follow it. */
const LIVE_SEARCH_DELAY_MS = 700;
/** Uploads in the "Recently uploaded" row, newest first. */
const RECENT_ROW_SIZE = 12;

/**
 * Search, laid out like the Android TV YouTube app: a mic and the query on
 * top, suggestions beside an on-page letter grid (never the system keyboard),
 * and results that follow the query as it is typed, in rows underneath.
 * Results arriving don't take focus from the keyboard; moving down into them
 * folds the keyboard away, and Up or Back to the query brings it back.
 */
export function SearchScreen({
  nav,
  initialQuery,
}: {
  nav: Nav;
  /** Set when the system hands us a voice search (see plugins/with-tv-search). */
  initialQuery?: string;
}) {
  const [text, setText] = useState(initialQuery ?? "");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [listening, setListening] = useState(false);
  // Not every TV ships a recogniser — this box has none — so the in-app mic
  // hides rather than offering a control that can only fail.
  const [micAvailable] = useState(() => {
    try {
      return speechRecognition?.isRecognitionAvailable() ?? false;
    } catch {
      return false;
    }
  });
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Show words as they are recognised, and search once the final result lands.
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (!transcript) return;
    setText(transcript);
    if (event.isFinal) setQuery(transcript.trim());
  });
  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    setVoiceError(event.message || "Voice search unavailable");
  });

  const startListening = async () => {
    if (!speechRecognition) return;
    setVoiceError(null);
    const permission = await speechRecognition.requestPermissionsAsync();
    if (!permission.granted) {
      setVoiceError("Microphone permission denied");
      return;
    }
    setText("");
    setListening(true);
    speechRecognition.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
    });
  };

  const toggleListening = () => {
    if (listening) {
      speechRecognition?.stop();
      return;
    }
    void startListening();
  };

  // Channels come with the first page only.
  const [channels, setChannels] = useState<ChannelTileData[]>([]);
  const feed = useInfiniteFeed<string>(
    (continuation) =>
      query
        ? trpcClient.search.videos
            .query({ q: query, continuation })
            .then((r) => {
              if (!continuation) {
                setChannels(
                  [...(r.channels ?? [])]
                    .sort(
                      (a, b) =>
                        (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0),
                    )
                    .map((c) => ({
                      channelId: c.channelId,
                      name: c.name,
                      avatarUrl: c.avatarUrl,
                      subscriberCount: c.subscriberCount,
                    })),
                );
              }
              return { items: r.videos, next: r.continuation ?? undefined };
            })
        : Promise.resolve({ items: [], next: undefined }),
    [query],
  );
  useEffect(() => {
    if (!query) setChannels([]);
  }, [query]);

  // The YouTube app's "Recently uploaded" row: the newest of what was found.
  const recentUploads = useMemo(
    () =>
      feed.videos
        .filter((v) => v.publishedAt)
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
        .slice(0, RECENT_ROW_SIZE),
    [feed.videos],
  );

  // The results follow the query as it is typed, a beat after typing pauses.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === query) return;
    const timer = setTimeout(() => setQuery(trimmed), LIVE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  // Suggestions follow what's typed (or dictated), a beat after it settles.
  const [suggestFor, setSuggestFor] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSuggestFor(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const suggestions = trpc.search.suggestions.useQuery(
    { q: suggestFor },
    { enabled: suggestFor.length > 1 },
  );

  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    loadRecentSearches().then(setRecent);
  }, []);
  const remember = useCallback((q: string) => {
    const trimmed = q.trim();
    if (trimmed) setRecent((r) => rememberSearch(r, trimmed));
  }, []);

  const search = (q: string) => {
    const trimmed = q.trim();
    setVoiceError(null);
    setText(trimmed);
    setQuery(trimmed);
    remember(trimmed);
  };

  const searchRef = useRef(search);
  searchRef.current = search;
  // A new voice search from the system (see Shell) runs as if typed.
  useEffect(() => {
    if (initialQuery !== undefined) searchRef.current(initialQuery);
  }, [initialQuery]);

  // Open while focus is on the query, the keyboard or the suggestions; folded
  // away once it moves down into the results, as the YouTube app does.
  const [keyboardOpen, setKeyboardOpen] = useState(true);
  const resultsRef = useRef<FlatList<UnifiedVideo[]>>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const onResultFocus = useCallback(
    (focused: boolean) => {
      if (!focused) return;
      setKeyboardOpen(false);
      // Going into the results is choosing them: the query becomes recent.
      remember(textRef.current);
    },
    [remember],
  );
  const openKeyboard = () => {
    setKeyboardOpen(true);
    resultsRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // Back from the results returns to the query (and its keyboard) first;
  // from there it leaves as before.
  const barRef = useRef<TVFocusGuide>(null);
  const [queryBox, setQueryBox] = useState<ViewInstance | null>(null);
  useActiveBackHandler(() => {
    if (keyboardOpen) return false;
    openKeyboard();
    barRef.current?.requestTVFocus?.();
    return true;
  });

  // Beside the keyboard: completions while typing, recent searches before.
  const typed = text.trim();
  const listWords = typed
    ? (suggestions.data?.suggestions ?? []).slice(0, 6)
    : recent.slice(0, 6);

  const status =
    voiceError ??
    (listening
      ? "Listening…"
      : query && feed.status === "ready" && feed.videos.length === 0
        ? "No results."
        : null);

  return (
    <View style={styles.container}>
      <TVFocusGuideView
        ref={barRef}
        destinations={queryBox ? [queryBox] : []}
        style={styles.bar}
      >
        {micAvailable ? (
          <RoundButton
            icon="mic"
            active={listening}
            onPress={toggleListening}
            onFocusChange={(f) => f && openKeyboard()}
            hasTVPreferredFocus
          />
        ) : null}
        <QueryPill
          ref={setQueryBox}
          text={text}
          onPress={openKeyboard}
          onFocusChange={(f) => f && openKeyboard()}
        />
      </TVFocusGuideView>

      {keyboardOpen ? (
        <View style={styles.entry}>
          <TVFocusGuideView autoFocus style={styles.words}>
            {listWords.map((word) => (
              <WordRow
                key={word}
                word={word}
                typed={typed}
                recent={!typed}
                onPress={() => search(word)}
              />
            ))}
          </TVFocusGuideView>
          <LetterKeyboard
            hasTVPreferredFocus={!micAvailable}
            onKey={(c) => {
              setVoiceError(null);
              setText((t) => t + c);
            }}
            onDelete={() => setText((t) => t.slice(0, -1))}
            onClear={() => setText("")}
            onSubmit={() => search(text)}
          />
        </View>
      ) : null}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <View style={styles.results}>
        {query ? (
          <CarouselFeed
            feed={feed}
            videos={feed.videos}
            onSelect={(videoId, videos) =>
              nav.openVideo(videoId, { context: { source: "feed", videos } })
            }
            // Results arrive while typing; they must not pull focus off the
            // keyboard.
            preferFirstRowFocus={false}
            listRef={resultsRef}
            onCardFocusChange={onResultFocus}
            firstRowTitle={`Results for “${query}”`}
            header={
              <View style={styles.resultsHeader}>
                {channels.length > 0 ? (
                  <ChannelTiles
                    title="Channels"
                    channels={channels}
                    onSelect={nav.openChannel}
                    onTileFocusChange={onResultFocus}
                  />
                ) : null}
                {recentUploads.length > 3 ? (
                  <VideoRow
                    title="Recently uploaded"
                    videos={recentUploads}
                    onSelect={(videoId) =>
                      nav.openVideo(videoId, {
                        context: { source: "feed", videos: recentUploads },
                      })
                    }
                    onCardFocusChange={onResultFocus}
                  />
                ) : null}
              </View>
            }
            emptyText=""
          />
        ) : null}
      </View>
    </View>
  );
}

/** The query as typed, in a pill; focusing it brings the keyboard back. */
const QueryPill = forwardRef<
  ViewInstance,
  { text: string; onPress: () => void; onFocusChange: (f: boolean) => void }
>(function QueryPill({ text, onPress, onFocusChange }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={ref}
      onFocus={() => {
        setFocused(true);
        onFocusChange(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange(false);
      }}
      onPress={onPress}
      style={[styles.pill, focused && styles.pillFocused]}
    >
      <Text
        style={[styles.pillText, !text && styles.pillPlaceholder]}
        numberOfLines={1}
      >
        {text || "Search"}
      </Text>
    </Pressable>
  );
});

function RoundButton({
  icon,
  active,
  onPress,
  onFocusChange,
  hasTVPreferredFocus,
}: {
  icon: keyof typeof Feather.glyphMap;
  active?: boolean;
  onPress: () => void;
  onFocusChange?: (focused: boolean) => void;
  hasTVPreferredFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
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
      onPress={onPress}
      style={[
        styles.round,
        active && styles.roundActive,
        focused && styles.roundFocused,
      ]}
    >
      <Feather
        name={icon}
        size={s(20)}
        color={focused ? colors.focusForeground : colors.foreground}
      />
    </Pressable>
  );
}

/**
 * A suggestion (what's typed, then the rest in bold, as in the YouTube app)
 * or a recent search.
 */
function WordRow({
  word,
  typed,
  recent,
  onPress,
}: {
  word: string;
  typed: string;
  recent: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const color = focused ? colors.focusForeground : colors.foreground;
  const prefix =
    typed && word.toLowerCase().startsWith(typed.toLowerCase())
      ? word.slice(0, typed.length)
      : "";
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.word, focused && styles.wordFocused]}
    >
      <Feather name={recent ? "clock" : "search"} size={s(16)} color={color} />
      <Text style={[styles.wordText, { color }]} numberOfLines={1}>
        {prefix}
        <Text style={styles.wordRest}>{word.slice(prefix.length)}</Text>
      </Text>
    </Pressable>
  );
}

const BAR_HEIGHT = 44;

const styles = createStyles({
  container: { flex: 1, gap: spacing.md, paddingTop: spacing.sm },
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  round: {
    width: BAR_HEIGHT,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceStrong,
  },
  roundActive: { backgroundColor: colors.brand },
  roundFocused: { backgroundColor: colors.focusFill },
  pill: {
    width: 480,
    height: BAR_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.surfaceStrong,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  pillFocused: { borderColor: colors.ring },
  pillText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  pillPlaceholder: { color: colors.mutedForeground },
  entry: { flexDirection: "row", gap: spacing.xl },
  words: { width: 240, gap: 2 },
  word: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  wordFocused: { backgroundColor: colors.focusFill },
  wordText: { flex: 1, fontSize: fontSize.md },
  wordRest: { fontWeight: "700" },
  status: { color: colors.mutedForeground, fontSize: fontSize.md },
  results: { flex: 1 },
  resultsHeader: { gap: spacing.lg },
});
