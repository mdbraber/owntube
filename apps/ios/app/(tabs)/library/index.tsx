import { Button, Host, Image, Label, List, Section } from "@expo/ui/swift-ui";
import { foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { router, Stack } from "expo-router";
import { PlatformColor, StyleSheet, View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import { ACCENT } from "@/lib/theme";

/** A web page (`path`), or a native screen of this tab (`route`). */
type Row = { title: string; icon: SFSymbol } & (
  | { path: string; route?: never }
  | { route: "/library/settings"; path?: never }
);

/**
 * The web app's account destinations (its sidebar and account menu), as a
 * native list. Rows open the web page on this tab's stack.
 */
const SECTIONS: { title?: string; rows: Row[] }[] = [
  {
    rows: [
      {
        title: "Queue",
        path: "/queue",
        icon: "text.line.first.and.arrowtriangle.forward",
      },
      { title: "Saved", path: "/saved", icon: "bookmark" },
      { title: "Favorites", path: "/favorites", icon: "star" },
      { title: "Playlists", path: "/playlists", icon: "music.note.list" },
      { title: "History", path: "/history", icon: "clock.arrow.circlepath" },
    ],
  },
  {
    title: "Explore",
    rows: [
      { title: "Recommended", path: "/recommended", icon: "sparkles" },
      { title: "Live", path: "/live", icon: "dot.radiowaves.left.and.right" },
      { title: "Shorts", path: "/shorts", icon: "play.rectangle.on.rectangle" },
    ],
  },
  {
    rows: [
      { title: "Settings", route: "/library/settings", icon: "gearshape" },
      { title: "Algorithm", path: "/dashboard", icon: "slider.horizontal.3" },
    ],
  },
];

export default function LibraryScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Library", headerLargeTitle: true }} />
      {/* iPad: a readable column on the grouped background, as Settings. */}
      <View style={readable.page}>
        <Host style={readable.column}>
          <List>
            {SECTIONS.map((section, index) => (
              <Section key={section.title ?? index} title={section.title}>
                {section.rows.map((row) => (
                  <Button
                    key={row.title}
                    // Settings-style rows: label text in the primary colour,
                    // only the icon in the accent.
                    modifiers={[
                      foregroundStyle({
                        type: "hierarchical",
                        style: "primary",
                      }),
                    ]}
                    onPress={() =>
                      row.route
                        ? router.push(row.route)
                        : router.push({
                            pathname: "/library/page",
                            params: { path: row.path, title: row.title },
                          })
                    }
                  >
                    <Label
                      title={row.title}
                      icon={<Image systemName={row.icon} color={ACCENT} />}
                    />
                  </Button>
                ))}
              </Section>
            ))}
          </List>
        </Host>
      </View>
    </>
  );
}

const readable = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    backgroundColor: PlatformColor("systemGroupedBackground"),
  },
  column: { flex: 1, width: "100%", maxWidth: 720 },
});
