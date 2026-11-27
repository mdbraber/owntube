"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * What a memo may use: text formatting, links, lists, quotes and code. No
 * raw HTML (react-markdown never renders it), no images or headings, which a
 * note on a video doesn't need and an automation shouldn't inject.
 */
const ALLOWED = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
];

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline decoration-[hsl(var(--memo-muted))] underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[hsl(var(--memo-border))] pl-3 text-[hsl(var(--memo-muted))]">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[hsl(var(--memo-border)_/_0.45)] px-1 py-px font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-[hsl(var(--memo-border)_/_0.3)] p-2 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
};

/** A memo's text as Markdown (GitHub flavour: autolinks, ~~strike~~). */
export function MemoMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 break-words text-sm leading-6">
      <Markdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
