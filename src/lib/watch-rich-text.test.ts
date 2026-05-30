import { describe, expect, it } from "vitest";
import { parseRichText, youtubeTimestampFromUrl } from "@/lib/watch-rich-text";

describe("youtubeTimestampFromUrl", () => {
  it("reads t= seconds from watch URLs", () => {
    expect(
      youtubeTimestampFromUrl(
        "https://www.youtube.com/watch?v=cHocYnA_JVY&t=102",
      ),
    ).toBe(102);
    expect(
      youtubeTimestampFromUrl(
        "https://www.youtube.com/watch?v=cHocYnA_JVY&amp;t=102",
      ),
    ).toBe(102);
  });
});

describe("parseRichText", () => {
  it("turns Invidious HTML timestamp anchors into time parts", () => {
    const parts = parseRichText(
      '<a href="https://www.youtube.com/watch?v=cHocYnA_JVY&amp;t=102">1:42</a> Jim: NO IT CANT BE DEAD',
    );
    expect(parts).toEqual([
      { kind: "time", value: "1:42", seconds: 102 },
      { kind: "text", value: " Jim: NO IT CANT BE DEAD" },
    ]);
  });

  it("links bare timestamps in plain text", () => {
    const parts = parseRichText("Jump to 1:42 for the best part");
    expect(parts).toEqual([
      { kind: "text", value: "Jump to " },
      { kind: "time", value: "1:42", seconds: 102 },
      { kind: "text", value: " for the best part" },
    ]);
  });
});
