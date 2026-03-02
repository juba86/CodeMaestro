"use client";

import { Clock, Tag, GitBranch } from "lucide-react";

interface PromptCardProps {
  prompt: {
    id: string;
    title: string;
    description: string;
    updatedAt: string;
    tags: { id: string; tag: string }[];
    _count: { versions: number; testResults: number };
  };
  onClick: () => void;
}

export function PromptCard({ prompt, onClick }: PromptCardProps) {
  return (
    <button
      onClick={onClick}
      className="text-left p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-colors space-y-2"
    >
      <h3 className="font-semibold text-sm truncate">{prompt.title}</h3>
      {prompt.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{prompt.description}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitBranch size={12} /> v{prompt._count.versions}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={12} /> {new Date(prompt.updatedAt).toLocaleDateString()}
        </span>
      </div>
      {prompt.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {prompt.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-accent"
            >
              <Tag size={10} /> {t.tag}
            </span>
          ))}
          {prompt.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{prompt.tags.length - 3}</span>
          )}
        </div>
      )}
    </button>
  );
}
