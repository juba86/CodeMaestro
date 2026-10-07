"use client";

import { memo } from "react";
import { AlertCircle, BookOpen, Brain, Cpu, FileText, Network, Sparkles, Wrench } from "lucide-react";
import type { Msg, PlannedSubtask } from "./types";

function parseMeta<T>(meta: string | undefined): Partial<T> {
  try {
    return (JSON.parse(meta || "{}") ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

// Items are immutable (new object on change), so memo skips every bubble but
// the one that is streaming.
export const MessageBubble = memo(function MessageBubble({ msg }: { msg: Msg }) {
  switch (msg.role) {
    case "user":
      return (
        <div className={`ml-auto max-w-[85%] bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm ${msg.local ? "opacity-80" : ""}`}>
          <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
        </div>
      );
    case "system":
      // Run markers persisted by the server ("🔁 Iteration 2/10", "⏹ Ausführung gestoppt.").
      return (
        <div className="flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground" role="separator" aria-label={msg.content}>
          <span className="h-px flex-1 bg-border" />
          <span className="max-w-[80%] break-words text-center rounded-full border border-border bg-background px-2.5 py-0.5">{msg.content}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "plan": {
      const subtasks = parseMeta<{ subtasks: PlannedSubtask[] }>(msg.meta).subtasks ?? [];
      return (
        <div className="max-w-[95%] border border-primary/40 bg-primary/5 rounded-lg px-3 py-2 text-sm">
          <div className="flex items-center gap-1.5 font-semibold text-primary mb-1"><Network size={14} /> Orchestrierungsplan</div>
          <ol className="space-y-1 list-decimal list-inside">
            {subtasks.map((s) => (
              <li key={s.id} className="text-sm break-words">
                {s.title}
                <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-[11px]">
                  <Cpu size={10} /> {s.workerId}
                </span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case "synthesis":
      return (
        <div className="max-w-[95%] border border-green-500/40 bg-green-500/5 rounded-lg px-3 py-2 text-sm">
          <div className="flex items-center gap-1.5 font-semibold text-green-500 mb-1"><Sparkles size={14} /> Zusammenfassung</div>
          <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
        </div>
      );
    case "assistant": {
      const { worker, title } = parseMeta<{ worker: string; title: string }>(msg.meta);
      return (
        <div className="max-w-[90%] bg-accent rounded-lg px-3 py-2 text-sm">
          {worker && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <Cpu size={11} /> {worker}{title && ` · ${title}`}
            </div>
          )}
          <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
        </div>
      );
    }
    case "thinking":
      return (
        <details className="max-w-[90%] text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none inline-flex items-center gap-1.5 hover:text-foreground">
            <Brain size={12} /> Denkprozess
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans max-h-60 overflow-y-auto border-l-2 border-border pl-2">{msg.content}</pre>
        </details>
      );
    case "knowledge": {
      const sources = parseMeta<{ sources: string[] }>(msg.meta).sources ?? [];
      return (
        <div className="max-w-[90%] rounded-lg px-3 py-2 text-xs border border-violet-500/40 bg-violet-500/5 text-violet-300 flex items-start gap-1.5">
          <BookOpen size={13} className="mt-0.5 shrink-0" />
          <div className="min-w-0 break-words">
            <span className="font-medium">Wissensbasis genutzt</span>
            {sources.length > 0 && <span className="text-muted-foreground"> · {sources.join(", ")}</span>}
          </div>
        </div>
      );
    }
    case "tool_use": {
      const { input } = parseMeta<{ input: unknown }>(msg.meta);
      const shown = input === undefined ? "" : JSON.stringify(input, null, 2) ?? "";
      return (
        <div className="max-w-[90%] border border-border rounded-lg px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-blue-400"><Wrench size={12} /> {msg.content}</div>
          {shown && (
            <pre className="mt-1 whitespace-pre-wrap break-words text-muted-foreground max-h-32 overflow-y-auto">{shown.slice(0, 1200)}</pre>
          )}
        </div>
      );
    }
    case "tool_result": {
      const { isError } = parseMeta<{ isError: boolean }>(msg.meta);
      return (
        <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs border ${isError ? "border-red-500/40" : "border-border"}`}>
          <div className="flex items-center gap-1.5 text-muted-foreground"><FileText size={12} /> Ergebnis</div>
          <pre className="mt-1 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{(msg.content || "").slice(0, 2000)}</pre>
        </div>
      );
    }
    case "error":
      return (
        <div className="max-w-[90%] rounded-lg px-3 py-2 text-xs border border-red-500/40 text-red-400 flex items-start gap-1.5">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <pre className="whitespace-pre-wrap break-words min-w-0">{msg.content}</pre>
        </div>
      );
    default:
      return null;
  }
});
