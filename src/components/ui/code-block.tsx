"use client";

import type * as React from "react";
import { Check, Copy, FolderOpen, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./button";
import { useCopy } from "./copy-text";

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopy();
  return (
    <>
      <IconButton aria-label={copied ? "Kopiert" : label} size="icon-sm" onClick={() => void copy(text)}>
        {copied ? <Check className="text-success" /> : <Copy />}
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {copied ? "Kopiert" : ""}
      </span>
    </>
  );
}

export type CodeBlockProps = Omit<React.ComponentProps<"div">, "children"> & {
  code: string;
  /** Header text, e.g. a file name. */
  title?: React.ReactNode;
  /** Wrap long lines instead of scrolling horizontally. */
  wrap?: boolean;
  copyLabel?: string;
  /** Hide the copy button. */
  noCopy?: boolean;
};

/** Monospace block with a copy button (works over plain http too). */
export function CodeBlock({
  code,
  title,
  wrap = false,
  copyLabel = "Kopieren",
  noCopy = false,
  className,
  ...props
}: CodeBlockProps) {
  return (
    <div
      data-slot="code-block"
      className={cn("group/code relative min-w-0 overflow-hidden rounded-lg border border-border bg-surface-2", className)}
      {...props}
    >
      {title ? (
        <div className="flex h-9 items-center gap-2 border-b border-border pl-3 pr-1 md:h-8">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{title}</span>
          {noCopy ? null : <CopyButton text={code} label={copyLabel} />}
        </div>
      ) : null}
      <pre
        tabIndex={0}
        className={cn(
          "max-h-[inherit] overflow-auto p-3 font-mono text-xs leading-5 text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          !title && !noCopy && "pr-11",
        )}
      >
        <code>{code}</code>
      </pre>
      {!title && !noCopy ? (
        <div className="absolute right-1 top-1">
          <CopyButton text={code} label={copyLabel} />
        </div>
      ) : null}
    </div>
  );
}

export type CommandBlockProps = Omit<React.ComponentProps<"div">, "children"> & {
  command: string;
  /** Working directory the command runs in. */
  cwd?: string;
  /**
   * Sandbox line: `true` → „Sandbox an · nur Projektordner", `false` →
   * „Sandbox aus", a string → custom text. Omit to hide.
   */
  sandbox?: boolean | string;
  copyLabel?: string;
};

/** A shell command with its cwd and an optional sandbox line. */
export function CommandBlock({ command, cwd, sandbox, copyLabel = "Befehl kopieren", className, ...props }: CommandBlockProps) {
  const sandboxOn = sandbox === true || (typeof sandbox === "string" && sandbox.length > 0);
  return (
    <div
      data-slot="command-block"
      className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-surface-2", className)}
      {...props}
    >
      <div className="flex min-h-9 items-center gap-2 border-b border-border pl-3 pr-1 md:min-h-8">
        <FolderOpen aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={cwd}>
          {cwd ?? "Projektordner"}
        </span>
        <CopyButton text={command} label={copyLabel} />
      </div>
      <pre
        tabIndex={0}
        className="overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-5 text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:text-[0.8125rem]"
      >
        <span aria-hidden className="select-none text-subtle-foreground">$ </span>
        <code>{command}</code>
      </pre>
      {sandbox !== undefined ? (
        <div
          className={cn(
            "flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-ui",
            sandboxOn ? "text-success" : "text-warning",
          )}
        >
          {sandboxOn ? <ShieldCheck aria-hidden className="size-3.5 shrink-0" /> : <ShieldAlert aria-hidden className="size-3.5 shrink-0" />}
          <span className="text-muted-foreground">
            {typeof sandbox === "string" ? sandbox : sandbox ? "Sandbox an · nur Projektordner" : "Sandbox aus"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
