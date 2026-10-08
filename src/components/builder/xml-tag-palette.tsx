"use client";

import { Button } from "@/components/ui/button";

const tags = [
  "instructions",
  "context",
  "constraints",
  "target-audience",
  "output-format",
  "examples",
  "example",
  "input",
  "method",
  "answer",
  "task",
  "swarm-config",
  "agents",
  "agent",
];

interface XmlTagPaletteProps {
  onInsert: (tag: string) => void;
}

/** Wraps the editor's selection in a tag (or inserts an empty pair at the cursor). */
export function XmlTagPalette({ onInsert }: XmlTagPaletteProps) {
  return (
    <div
      role="group"
      aria-labelledby="pb-tag-palette"
      className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
    >
      <span id="pb-tag-palette" className="mr-1 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        Tag um Auswahl:
      </span>
      {tags.map((tag) => (
        <Button
          key={tag}
          variant="outline"
          size="sm"
          className="shrink-0 px-2.5 font-mono md:h-6 md:px-2"
          onClick={() => onInsert(tag)}
          aria-label={`<${tag}> einfügen`}
        >
          &lt;{tag}&gt;
        </Button>
      ))}
    </div>
  );
}
