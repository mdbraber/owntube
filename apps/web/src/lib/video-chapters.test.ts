import { describe, expect, it } from "vitest";
import {
  chapterIndexAt,
  parseChaptersFromDescription,
} from "@/lib/video-chapters";

describe("parseChaptersFromDescription", () => {
  it("parses chapters in mm:ss format", () => {
    const description = `
📌 Chapters:
00:00 What is Netflix VOID?
01:05 How VOID Understands Physics
02:06 The Two-Pass Pipeline Explained
03:19 Training AI with Synthetic Reality
`;
    expect(parseChaptersFromDescription(description)).toEqual([
      { startSeconds: 0, title: "What is Netflix VOID?" },
      { startSeconds: 65, title: "How VOID Understands Physics" },
      { startSeconds: 126, title: "The Two-Pass Pipeline Explained" },
      { startSeconds: 199, title: "Training AI with Synthetic Reality" },
    ]);
  });

  it("parses chapters in m:ss format", () => {
    const description = `
CHAPTERS
---------------------------------------------------
0:00 Intro
1:04 Physical Tour of the Controller
5:29 The Best Feature
`;
    expect(parseChaptersFromDescription(description)).toEqual([
      { startSeconds: 0, title: "Intro" },
      { startSeconds: 64, title: "Physical Tour of the Controller" },
      { startSeconds: 329, title: "The Best Feature" },
    ]);
  });

  it("returns empty when chapter list does not start at 0:00", () => {
    const description = `
1:04 Intro
2:30 Main part
`;
    expect(parseChaptersFromDescription(description)).toEqual([]);
  });

  it("returns empty for a single timestamp mention", () => {
    const description = "This happened around 12:34 in the stream.";
    expect(parseChaptersFromDescription(description)).toEqual([]);
  });

  it("validates chapters against duration when provided", () => {
    const description = `
0:00 Intro
0:30 Main section
2:10 End
`;
    expect(parseChaptersFromDescription(description, 120)).toEqual([]);
  });

  it("parses chapters from Piped HTML description with timestamp links", () => {
    const description =
      'Chapters<br><a href="https://www.youtube.com/watch?v=abc&t=0">0:00 Intro</a><br><a href="https://www.youtube.com/watch?v=abc&t=65">1:05 Middle</a><br><a href="https://www.youtube.com/watch?v=abc&t=130">2:10 Outro</a>';
    expect(parseChaptersFromDescription(description)).toEqual([
      { startSeconds: 0, title: "Intro" },
      { startSeconds: 65, title: "Middle" },
      { startSeconds: 130, title: "Outro" },
    ]);
  });

  it("parses chapters with dash separator", () => {
    const description = "0:00 - Intro\n1:30 - Main topic";
    expect(parseChaptersFromDescription(description)).toEqual([
      { startSeconds: 0, title: "Intro" },
      { startSeconds: 90, title: "Main topic" },
    ]);
  });
});

describe("chapterIndexAt", () => {
  const chapters = [
    { startSeconds: 0, title: "Intro" },
    { startSeconds: 60, title: "Middle" },
    { startSeconds: 180, title: "Outro" },
  ];

  it("returns the matching chapter index for a given time", () => {
    expect(chapterIndexAt(chapters, 0)).toBe(0);
    expect(chapterIndexAt(chapters, 30)).toBe(0);
    expect(chapterIndexAt(chapters, 60)).toBe(1);
    expect(chapterIndexAt(chapters, 179)).toBe(1);
    expect(chapterIndexAt(chapters, 180)).toBe(2);
    expect(chapterIndexAt(chapters, 999)).toBe(2);
  });

  it("returns -1 for empty chapters", () => {
    expect(chapterIndexAt([], 0)).toBe(-1);
  });
});
