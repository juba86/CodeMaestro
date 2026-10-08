"use client";

// Agent answers as Markdown (GFM: headings, lists, tables, links, inline code,
// fenced code with a copy button). Raw HTML is never rendered — react-markdown
// escapes it (no rehype-raw) — and its URL transform drops javascript: and
// other unsafe links. Remote images are not loaded (tracking pixels); their
// alt text is shown instead.
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/ui/code-block";
import { cn } from "@/components/ui/cn";
import { topHeadingDepth } from "./markdown-outline";

type CodeChild = React.ReactElement<{ className?: string; children?: React.ReactNode }>;

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const components: Components = {
  pre({ children }) {
    const child = (Array.isArray(children) ? children[0] : children) as CodeChild | undefined;
    const code = textOf(child && React.isValidElement(child) ? child.props.children : children).replace(/\n$/, "");
    const lang = /language-([\w+#.-]+)/.exec((child && React.isValidElement(child) ? child.props.className : "") ?? "")?.[1];
    return <CodeBlock code={code} title={lang} copyLabel="Code kopieren" className="my-3" />;
  },
  code({ children, className }) {
    return (
      <code className={cn("rounded-sm border border-border bg-surface-2 px-1 py-px font-mono text-[0.9em] [overflow-wrap:anywhere]", className)}>
        {children}
      </code>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-text underline underline-offset-4 hover:no-underline">
        {children}
      </a>
    );
  },
  img({ alt }) {
    return <span className="text-muted-foreground">[Bild{alt ? `: ${alt}` : ""}]</span>;
  },
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children, className }) => (
    <ul className={cn("my-2 list-disc space-y-1 pl-5 marker:text-subtle-foreground", className?.includes("contains-task-list") && "list-none pl-1")}>
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 list-decimal space-y-1 pl-5 marker:text-subtle-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5 [&>input]:mr-1.5 [&>input]:align-middle">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-ui">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="border-b border-border px-3 py-1.5 font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-border px-3 py-1.5 align-top">
      {children}
    </td>
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? <input type="checkbox" checked={!!checked} readOnly disabled className="size-3.5 accent-primary" /> : null,
};

const plugins = [remarkGfm];

const HEADING_CLASS = [
  "",
  "",
  "mb-2 mt-4 text-base font-semibold first:mt-0",
  "mb-2 mt-4 text-[15px] font-semibold first:mt-0",
  "mb-1.5 mt-3 text-sm font-semibold first:mt-0",
  "mb-1 mt-3 text-sm font-semibold first:mt-0",
  "mb-1 mt-3 text-sm font-medium first:mt-0",
];

function headingComponents(top: number): Components {
  const make = (depth: number) => {
    const level = Math.min(6, Math.max(2, depth - top + 2));
    const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
    const Heading = ({ children }: { children?: React.ReactNode }) => <Tag className={HEADING_CLASS[level]}>{children}</Tag>;
    return Heading;
  };
  return { h1: make(1), h2: make(2), h3: make(3), h4: make(4), h5: make(5), h6: make(6) };
}

const byTop = new Map<number, Components>();
function componentsFor(top: number): Components {
  let c = byTop.get(top);
  if (!c) {
    c = { ...components, ...headingComponents(top) };
    byTop.set(top, c);
  }
  return c;
}

/** Markdown text of the agent (memoised: only the streaming message re-renders). */
export const Markdown = React.memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 break-words [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown remarkPlugins={plugins} components={componentsFor(topHeadingDepth(text))}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
