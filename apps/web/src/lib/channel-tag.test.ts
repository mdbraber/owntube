import { describe, expect, it } from "vitest";
import { CHANNEL_TAG_MAX_LEN, normalizeChannelTag } from "@/lib/channel-tag";

describe("normalizeChannelTag", () => {
  it("strips a leading # and lowercases", () => {
    expect(normalizeChannelTag("#Tech")).toBe("tech");
    expect(normalizeChannelTag("##News")).toBe("news");
  });

  it("trims and collapses inner whitespace", () => {
    expect(normalizeChannelTag("  video   essays  ")).toBe("video essays");
  });

  it("drops disallowed characters but keeps - and _", () => {
    expect(normalizeChannelTag("sci-fi_stuff!!!")).toBe("sci-fi_stuff");
    expect(normalizeChannelTag("c++ dev")).toBe("c dev");
  });

  it("caps length", () => {
    const long = "a".repeat(CHANNEL_TAG_MAX_LEN + 20);
    expect(normalizeChannelTag(long)?.length).toBe(CHANNEL_TAG_MAX_LEN);
  });

  it("returns null when nothing usable remains", () => {
    expect(normalizeChannelTag("")).toBeNull();
    expect(normalizeChannelTag("###")).toBeNull();
    expect(normalizeChannelTag("   ")).toBeNull();
    expect(normalizeChannelTag("!!!")).toBeNull();
  });
});
