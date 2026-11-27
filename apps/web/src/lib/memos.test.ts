import { describe, expect, it } from "vitest";
import { formatMemoTime, memoSourceLabel } from "@/lib/memos";

const local = (y: number, m: number, d: number, h: number, min: number) =>
  Math.floor(new Date(y, m, d, h, min).getTime() / 1000);

describe("formatMemoTime", () => {
  const now = new Date(2026, 10, 27, 18, 0);
  it("is day, month and time this year", () => {
    expect(formatMemoTime(local(2026, 10, 27, 14, 32), now)).toBe(
      "27 Nov 14:32",
    );
    expect(formatMemoTime(local(2026, 0, 3, 9, 5), now)).toBe("3 Jan 09:05");
  });
  it("adds the year for other years", () => {
    expect(formatMemoTime(local(2025, 10, 27, 14, 32), now)).toBe(
      "27 Nov 2025 14:32",
    );
  });
});

describe("memoSourceLabel", () => {
  const base = { url: null, label: null, author: null };
  it("says You for a memo typed here", () => {
    expect(memoSourceLabel({ ...base, kind: "direct" })).toBe("You");
  });
  it("names who and where for Slack, with what is known", () => {
    const slack = {
      kind: "slack" as const,
      url: "https://acme.slack.com/archives/C1/p1",
    };
    expect(
      memoSourceLabel({ ...slack, label: "#design", author: "Anna" }),
    ).toBe("Anna in #design");
    expect(memoSourceLabel({ ...slack, label: "#design", author: null })).toBe(
      "#design",
    );
    expect(memoSourceLabel({ ...slack, label: null, author: "Anna" })).toBe(
      "Anna",
    );
    expect(memoSourceLabel({ ...slack, label: null, author: null })).toBe(
      "Slack",
    );
  });
  it("uses a link's label, else its host", () => {
    const link = {
      kind: "link" as const,
      url: "https://www.example.com/a/b",
      author: null,
    };
    expect(memoSourceLabel({ ...link, label: "Blog post" })).toBe("Blog post");
    expect(memoSourceLabel({ ...link, label: null })).toBe("example.com");
  });
});
