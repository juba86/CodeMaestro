"use client";

const tags = [
  "instructions",
  "context",
  "constraints",
  "target-audience",
  "output-format",
  "examples",
  "example",
  "input",
  "thinking",
  "answer",
  "task",
  "swarm-config",
  "agents",
  "agent",
];

interface XmlTagPaletteProps {
  onInsert: (tag: string) => void;
}

export function XmlTagPalette({ onInsert }: XmlTagPaletteProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-xs text-muted-foreground self-center mr-1">Tags:</span>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onInsert(tag)}
          title={`Insert <${tag}> tag`}
          className="px-2 py-0.5 text-xs rounded bg-accent hover:bg-accent/80 font-mono"
        >
          &lt;{tag}&gt;
        </button>
      ))}
    </div>
  );
}
