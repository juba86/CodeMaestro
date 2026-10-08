"use client";

import { formatRelative } from "@/lib/format";
import { cn } from "@/components/ui/cn";

export interface PromptSummary {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  createdAt?: string;
  tags: { id: string; tag: string }[];
  _count: { versions: number; testResults: number };
}

interface PromptCardProps {
  prompt: PromptSummary;
  selected?: boolean;
  onClick: () => void;
}

/** One library row: title, two-line description, version, date, tags. */
export function PromptCard({ prompt, selected = false, onClick }: PromptCardProps) {
  return (
    <button
      type="button"
      data-prompt-id={prompt.id}
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block w-full rounded-lg border p-3 text-left transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-primary-border bg-primary-subtle"
          : "border-border bg-card hover:border-border-strong hover:bg-accent/60",
      )}
    >
      <span className="block truncate text-sm font-medium text-foreground md:text-ui">{prompt.title}</span>
      {prompt.description ? (
        <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{prompt.description}</span>
      ) : null}
      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
        <span className="font-mono tabular-nums">v{prompt._count.versions}</span>
        <span aria-hidden>·</span>
        <span>{formatRelative(prompt.updatedAt)}</span>
        {prompt.tags.length > 0 ? (
          <>
            <span aria-hidden>·</span>
            {prompt.tags.slice(0, 3).map((t) => (
              <span key={t.id} className="rounded-sm border border-border bg-surface-2 px-1.5 leading-5 text-muted-foreground">
                {t.tag}
              </span>
            ))}
            {prompt.tags.length > 3 ? <span>+{prompt.tags.length - 3}</span> : null}
          </>
        ) : null}
      </span>
    </button>
  );
}
