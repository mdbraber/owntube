import { describe, expect, it } from "vitest";
import { normalizePipedDescription } from "./normalize-video-description";

describe("normalizePipedDescription", () => {
  it("converts br tags to newlines", () => {
    expect(
      normalizePipedDescription("Line one<br>Line two<br/>Line three"),
    ).toBe("Line one\nLine two\nLine three");
  });

  it("extracts href from anchor tags", () => {
    const input =
      'Links:<br><a href="https://example.com/foo">Example</a><br><a href="https://example.com/bar">https://example.com/bar</a>';
    expect(normalizePipedDescription(input)).toBe(
      "Links:\nhttps://example.com/foo\nhttps://example.com/bar",
    );
  });

  it("preserves chapter timestamps as plain text", () => {
    const input = "Chapters<br>0:00 Intro<br>1:30 Main topic";
    expect(normalizePipedDescription(input)).toBe(
      "Chapters\n0:00 Intro\n1:30 Main topic",
    );
  });

  it("decodes HTML entities", () => {
    expect(normalizePipedDescription("Tom &amp; Jerry &mdash; fun")).toBe(
      "Tom & Jerry &mdash; fun",
    );
  });

  it("strips remaining tags", () => {
    expect(normalizePipedDescription("<b>Bold</b> text")).toBe("Bold text");
  });

  it("keeps chapter lines from timestamp anchor labels", () => {
    const input =
      'Chapters<br><a href="https://www.youtube.com/watch?v=abc&t=0">0:00 Intro</a><br><a href="https://www.youtube.com/watch?v=abc&t=65">1:05 Main part</a>';
    expect(normalizePipedDescription(input)).toBe(
      "Chapters\n0:00 Intro\n1:05 Main part",
    );
  });

  it("builds chapter lines from t= deep links when label is plain text", () => {
    const input =
      '<a href="https://www.youtube.com/watch?v=abc&t=0">Intro</a><br><a href="https://www.youtube.com/watch?v=abc&t=125">Outro</a>';
    expect(normalizePipedDescription(input)).toBe("0:00 Intro\n2:05 Outro");
  });

  it("does not duplicate timestamp when anchor label is timestamp-only", () => {
    const input =
      'Chapters<br><a href="https://www.youtube.com/watch?v=abc&t=0">0:00</a> Intro<br><a href="https://www.youtube.com/watch?v=abc&t=65">1:05</a> Main';
    expect(normalizePipedDescription(input)).toBe(
      "Chapters\n0:00 Intro\n1:05 Main",
    );
  });
});
