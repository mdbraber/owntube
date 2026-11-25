import { Button, Host, Image, Label, List, Section } from "@expo/ui/swift-ui";
import { foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { router, Stack } from "expo-router";
import type { SFSymbol } from "sf-symbols-typescript";
import { ACCENT } from "@/lib/theme";

type Row = { title: string; path: string; icon: SFSymbol };

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
      { title: "Trending", path: "/trending", icon: "flame" },
      { title: "Shorts", path: "/shorts", icon: "play.rectangle.on.rectangle" },
    ],
  },
  {
    rows: [
      { title: "Settings", path: "/settings", icon: "gearshape" },
      { title: "Algorithm", path: "/dashboard", icon: "slider.horizontal.3" },
    ],
  },
];

export default function LibraryScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Library", headerLargeTitle: true }} />
      <Host style={{ flex: 1 }}>
        <List>
          {SECTIONS.map((section, index) => (
            <Section key={section.title ?? index} title={section.title}>
              {section.rows.map((row) => (
                <Button
                  key={row.path}
                  // Settings-style rows: label text in the primary colour,
                  // only the icon in the accent.
                  modifiers={[
                    foregroundStyle({ type: "hierarchical", style: "primary" }),
                  ]}
                  onPress={() =>
                    router.push({
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
    </>
  );
}
