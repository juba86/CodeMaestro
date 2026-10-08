"use client";

import * as React from "react";
import {
  Bot,
  Check,
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  Search,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import {
  actionCount,
  canonicalTool,
  formatToolDuration,
  headLines,
  tailLines,
  type ToolCall,
  type ToolGroupModel,
} from "./tool-calls";

const ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Grep: Search,
  Glob: FolderSearch,
  LS: FolderSearch,
  Bash: SquareTerminal,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Write: FilePlus,
  WebSearch: Globe,
  WebFetch: Globe,
  TodoWrite: ListTodo,
  Task: Bot,
};

const MAX_LINES = 12;

function ToolIcon({ name, className }: { name: string; className?: string }) {
  return React.createElement(ICONS[canonicalTool(name)] ?? Wrench, { "aria-hidden": true, className });
}

function inputText(call: ToolCall): string {
  const tool = canonicalTool(call.name);
  const i = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
  if (tool === "Bash" && typeof i.command === "string") return i.command;
  if (tool === "Write" && typeof i.content === "string") return i.content;
  if ((tool === "Edit" || tool === "MultiEdit") && typeof i.new_string === "string") {
    const old = typeof i.old_string === "string" ? i.old_string : "";
    return `− ${old.split("\n").join("\n− ")}\n+ ${i.new_string.split("\n").join("\n+ ")}`;
  }
  if (call.input === undefined) return "";
  try {
    return JSON.stringify(call.input, null, 2) ?? "";
  } catch {
    return "";
  }
}

function Clipped({ text, tail, label }: { text: string; tail?: boolean; label: string }) {
  const [all, setAll] = React.useState(false);
  const cut = tail ? tailLines(text, MAX_LINES) : headLines(text, MAX_LINES);
  const shown = all ? text.replace(/\n+$/, "") : cut.text;
  if (!text.trim()) return null;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-subtle-foreground">{label}</div>
      <pre
        tabIndex={0}
        className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-xs leading-5 text-foreground [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {!all && tail && cut.hidden > 0 ? <span className="text-subtle-foreground">… {cut.hidden} Zeilen davor{"\n"}</span> : null}
        {shown}
      </pre>
      {cut.hidden > 0 ? (
        <Button variant="link" size="xs" className="mt-1 text-xs" onClick={() => setAll((v) => !v)}>
          {all ? "Weniger anzeigen" : `Mehr anzeigen (${cut.hidden} Zeilen)`}
        </Button>
      ) : null}
    </div>
  );
}

function StatusMark({ call }: { call: ToolCall }) {
  if (call.status === "running") return <Spinner aria-label="läuft" className="size-3.5 text-primary-text" />;
  if (call.status === "ok") return <Check role="img" aria-label="erfolgreich" className="size-4 text-success" />;
  if (call.status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
        <X aria-hidden className="size-3.5" />
        Fehler
      </span>
    );
  return null;
}

function ToolRow({ call, id }: { call: ToolCall; id: string }) {
  const failed = call.status === "error";
  const [open, setOpen] = React.useState(failed);
  // A live call whose result fails later opens once with the tail of its output.
  const [sawError, setSawError] = React.useState(failed);
  if (failed && !sawError) {
    setSawError(true);
    setOpen(true);
  }
  const input = inputText(call);
  const output = call.result?.content ?? "";
  const expandable = Boolean(input.trim() || output.trim());
  const bodyId = `${id}-body`;
  return (
    <li className={cn("min-w-0", call.status === "error" && "bg-danger-subtle/40")} data-tool-row={call.key}>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? bodyId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full min-w-0 items-center gap-2 px-3 text-left text-ui hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:hover:bg-transparent md:min-h-8"
      >
        <ToolIcon name={call.name} className={cn("size-4 shrink-0", call.status === "error" ? "text-danger" : "text-subtle-foreground")} />
        <span className="shrink-0 font-medium text-foreground">{call.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={call.target}>
          {call.target}
        </span>
        <StatusMark call={call} />
      </button>
      {open && expandable ? (
        <div id={bodyId} className="space-y-2 border-t border-border px-3 py-2">
          {canonicalTool(call.name) === "Bash" && call.status === "error" ? null : <Clipped text={input} label="Eingabe" />}
          <Clipped text={output} tail={call.status === "error"} label={call.status === "error" ? "Ausgabe (Ende)" : "Ausgabe"} />
        </div>
      ) : null}
    </li>
  );
}

/** Consecutive tool calls as one foldable row (DESIGN.md §6.2.4). */
export const ToolGroup = React.memo(function ToolGroup({ group }: { group: ToolGroupModel }) {
  const id = React.useId();
  const hasError = group.errorCount > 0;
  const [open, setOpen] = React.useState(hasError);
  // A failure that arrives later opens the group once.
  const [sawError, setSawError] = React.useState(hasError);
  if (hasError && !sawError) {
    setSawError(true);
    setOpen(true);
  }
  const duration = group.durationMs !== undefined ? formatToolDuration(group.durationMs) : "";

  if (group.calls.length === 1) {
    return (
      <ul className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Werkzeugaufruf" data-tool-keys={group.calls[0].key}>
        <ToolRow call={group.calls[0]} id={id} />
      </ul>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" data-tool-keys={group.calls.map((c) => c.key).join(" ")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full min-w-0 items-center gap-2 px-3 text-left text-ui hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-subtle-foreground transition-transform duration-150", open && "rotate-90")} />
        <span className="shrink-0 font-medium text-foreground">{actionCount(group.calls.length)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{group.verbs}</span>
        {hasError ? (
          <Badge variant="danger" className="tabular-nums">
            {group.errorCount === 1 ? "1 Fehler" : `${group.errorCount} Fehler`}
          </Badge>
        ) : null}
        {group.running ? <Spinner aria-label="läuft" className="size-3.5 text-primary-text" /> : null}
        {duration ? <span className="shrink-0 font-mono text-xs tabular-nums text-subtle-foreground">{duration}</span> : null}
      </button>
      {open ? (
        <ul id={`${id}-list`} className="divide-y divide-border border-t border-border">
          {group.calls.map((c, i) => (
            <ToolRow key={c.key} call={c} id={`${id}-${i}`} />
          ))}
        </ul>
      ) : null}
    </div>
  );
});
