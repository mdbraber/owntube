import { describe, expect, it } from "vitest";
import {
  stripRestrictedListVideos,
  titleSuggestsMembersOnlyOrSubscriberOnly,
} from "@/lib/feed-exclude-restricted";
import type { UnifiedVideo } from "@/server/services/proxy.types";

describe("feed-exclude-restricted", () => {
  it("detects common members / subscribers only title patterns", () => {
    expect(titleSuggestsMembersOnlyOrSubscriberOnly("Weekly update")).toBe(
      false,
    );
    expect(
      titleSuggestsMembersOnlyOrSubscriberOnly(
        "Behind the scenes (Members only)",
      ),
    ).toBe(true);
    expect(
      titleSuggestsMembersOnlyOrSubscriberOnly("VLOG — Subscribers only"),
    ).toBe(true);
    expect(
      titleSuggestsMembersOnlyOrSubscriberOnly("Résumé — réservé aux membres"),
    ).toBe(true);
  });

  it("stripRestrictedListVideos removes matching titles", () => {
    const v: UnifiedVideo[] = [
      {
        videoId: "a",
        title: "Public",
      },
      {
        videoId: "b",
        title: "Member-only Q&A",
      },
    ];
    expect(stripRestrictedListVideos(v)).toHaveLength(1);
    expect(stripRestrictedListVideos(v)[0]?.videoId).toBe("a");
  });
});
