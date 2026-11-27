import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoMarkdown } from "@/components/watch/memo-markdown";

const html = (text: string) =>
  renderToStaticMarkup(createElement(MemoMarkdown, { text }));

describe("MemoMarkdown", () => {
  it("renders emphasis, code, lists and quotes", () => {
    const out = html("**Bold** _it_ ~~old~~ `x`\n\n- one\n- two\n\n> quoted");
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toContain("<del>old</del>");
    expect(out).toContain(">x</code>");
    expect(out).toMatch(/<ul[^>]*>\s*<li>one<\/li>/);
    expect(out).toContain("<blockquote");
  });

  it("opens links, bare ones too, in a new tab", () => {
    const out = html(
      "[View in Slack](https://acme.slack.com/archives/C1/p1) or https://x.org",
    );
    expect(out).toContain('href="https://acme.slack.com/archives/C1/p1"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://x.org"');
  });

  it("renders no HTML, scripts, images or headings from the text", () => {
    const out = html(
      "<img src=x onerror=alert(1)> <script>alert(1)</script>\n\n# Big\n\n![pic](https://x.org/a.png) [bad](javascript:alert(1))",
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<h1");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("Big");
  });
});
