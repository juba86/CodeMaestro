"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildRefinementSystemPrompt, QUICK_ACTIONS } from "@/lib/prompt-engine/refinement-prompts";
import { getModelProfile } from "@/lib/prompt-engine/model-profile";
import { parseXmlPartial, PROMPT_TAGS, tagPattern } from "@/lib/prompt-engine/xml-parser";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowLeft, Send, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { confirm } from "@/components/ui/confirm";
import { cn } from "@/components/ui/cn";
import { StepFooter } from "./step-footer";
import { quickActionLabel } from "./quick-action-labels";
import { markXmlInSync } from "./draft-sync";

const QUICK_BY_PROMPT = new Map(QUICK_ACTIONS.map((a) => [a.prompt, quickActionLabel(a.label)]));

// The chat API accepts at most 50 messages; keep the newest history turns.
const MAX_HISTORY = 40;

const ANY_PROMPT_TAG = PROMPT_TAGS.map(tagPattern).join("|");
const PROMPT_OPEN_RE = new RegExp(`<(?:${ANY_PROMPT_TAG})(?:\\s[^>]*)?>`, "i");
const PROMPT_CLOSE_RE = new RegExp(`</(?:${ANY_PROMPT_TAG})\\s*>`, "gi");
const FENCE_RE = /```[\w-]*[ \t]*\n([\s\S]*?)```/g;

/** Top-level prompt tags that occur in `text` as a complete open…close pair. */
function completeTagsIn(text: string): Set<string> {
  return new Set(
    PROMPT_TAGS.filter((t) => {
      const name = tagPattern(t);
      return new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}\\s*>`, "i").test(text);
    })
  );
}

/**
 * Picks the complete prompt XML out of an AI reply, or null when the reply only
 * quotes a snippet (applying e.g. a lone <instructions> block as "the prompt"
 * would blank everything else). Candidates are the fenced code blocks and, as
 * a fallback for unfenced replies or fences cut short by backticks inside the
 * prompt, the span from the first to the last prompt tag; the one with the
 * most complete tags wins (later candidates on ties, i.e. a revised version
 * shown after the original).
 */
function extractPromptXml(reply: string): string | null {
  const candidates: string[] = [];
  let first = reply.search(PROMPT_OPEN_RE);
  const closes = [...reply.matchAll(PROMPT_CLOSE_RE)];
  const last = closes[closes.length - 1];
  if (first >= 0 && last?.index !== undefined && last.index > first) {
    // Keep the first tag's indentation, so the parser can tell how deep the
    // content is indented (e.g. a prompt nested in <prompt>).
    let lineStart = first;
    while (lineStart > 0 && (reply[lineStart - 1] === " " || reply[lineStart - 1] === "\t")) lineStart--;
    if (lineStart === 0 || reply[lineStart - 1] === "\n") first = lineStart;
    candidates.push(reply.slice(first, last.index + last[0].length));
  }
  for (const m of reply.matchAll(FENCE_RE)) candidates.push(m[1]);

  let best: string | null = null;
  let bestTags = new Set<string>();
  for (const c of candidates) {
    const tags = completeTagsIn(c);
    if (tags.size > 0 && tags.size >= bestTags.size) {
      best = c;
      bestTags = tags;
    }
  }
  return best !== null && (bestTags.size >= 2 || bestTags.has("task")) ? best : null;
}

export function RefinementChat({ onBack }: { onBack: () => void }) {
  const {
    xmlContent, setXmlContent, chatMessages, addChatMessage, clearChat,
    isGenerating, setIsGenerating, updateStructured,
  } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  // The prompt is refined for the active model, as the quality panel lints it.
  const systemPrompt = useMemo(
    () => buildRefinementSystemPrompt(getModelProfile(activeProvider, activeModel)),
    [activeProvider, activeModel]
  );
  const [input, setInput] = useState("");
  const [announce, setAnnounce] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Keep the newest turn in view inside the chat box (not the page).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, isGenerating]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function sendMessage(text: string) {
    if (!text.trim() || isGenerating) return;

    const userMsg = `Current prompt XML:\n\`\`\`xml\n${xmlContent}\n\`\`\`\n\n${text}`;
    // Empty turns would fail the API's validation (content min length 1).
    const history = chatMessages
      .filter((m) => m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
    // Some providers reject a conversation that opens with an assistant turn.
    while (history[0]?.role === "assistant") history.shift();
    addChatMessage({ role: "user", content: text });
    setInput("");
    setAnnounce("");
    setIsGenerating(true);

    // Abort previous request if still running
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Idle timeout (reset on every received chunk) instead of a hard total cap.
    // Local Ollama models — especially large reasoning models — can take a long
    // time to first token, so a fixed 30s total would abort valid requests.
    const idleMs = activeProvider === "ollama" ? 180000 : 60000;
    let timeoutId = setTimeout(() => controller.abort(), idleMs);
    const resetIdle = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), idleMs);
    };

    try {
      // Load API key from encrypted localStorage (empty for local providers)
      const apiKey = await getApiKey(activeProvider);
      const baseUrl = getBaseUrl(activeProvider);

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: userMsg }],
          systemPrompt,
          provider: activeProvider,
          model: activeModel,
          stream: true,
          apiKey,
          baseUrl,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(typeof e?.error === "string" ? e.error : `Anfrage fehlgeschlagen (HTTP ${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Keine Antwort erhalten");

      let fullResponse = "";
      let streamError = "";
      let streamDone = false;
      const decoder = new TextDecoder();
      // Network chunks don't align with SSE lines: keep the trailing partial
      // line until the rest of it arrives.
      let buffer = "";

      const handleLine = (rawLine: string) => {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trimStart();
        if (data === "[DONE]") {
          streamDone = true;
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "error") {
            streamError = parsed.content || "Fehler im Antwortstrom";
          } else if (parsed.content) {
            fullResponse += parsed.content;
          }
        } catch { /* skip invalid JSON */ }
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer) handleLine(buffer);
          break;
        }
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleLine(line);
          if (streamDone) break;
        }
      }
      if (streamDone) reader.cancel().catch(() => {});

      if (streamError) toast.error(`Fehler der KI: ${streamError}`);
      if (!fullResponse.trim()) {
        if (!streamError) toast.error("Die KI hat eine leere Antwort geliefert.");
        return;
      }

      addChatMessage({ role: "assistant", content: fullResponse });
      setAnnounce("Antwort fertig");

      // Only apply a complete prompt, and merge it: sections the reply leaves
      // out (e.g. the technique, which models rarely echo) keep their values.
      const newXml = extractPromptXml(fullResponse);
      if (newXml) {
        updateStructured(parseXmlPartial(newXml));
        const next = useBuilderStore.getState().structured;
        setXmlContent(buildXml(next));
        markXmlInSync(next);
        toast.success("Prompt aus dem Vorschlag übernommen.");
      } else if (completeTagsIn(fullResponse).size > 0) {
        toast.info("Die Antwort enthält nur einen XML-Ausschnitt – nicht automatisch übernommen.");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("Zeitüberschreitung oder abgebrochen.");
      } else {
        toast.error(
          err instanceof Error
            ? `Verfeinern fehlgeschlagen: ${err.message}`
            : "Verfeinern fehlgeschlagen. Prüfe den API-Schlüssel in den Einstellungen.",
        );
        console.error(err);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  }

  async function handleClear() {
    const ok = await confirm({
      title: "Verlauf löschen?",
      description: "Der Prompt bleibt, wie er ist; nur das Gespräch wird gelöscht.",
      confirmLabel: "Löschen",
      tone: "danger",
    });
    if (ok) clearChat();
  }

  return (
    <section aria-labelledby="pb-step-title" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="pb-step-title" className="text-lg font-semibold">
            Verfeinern
          </h2>
          <p className="max-w-[70ch] text-ui text-muted-foreground">
            Die KI überarbeitet den Prompt auf Zuruf. Vollständige Vorschläge werden direkt übernommen; die Vorschau zeigt
            das Ergebnis.
          </p>
        </div>
        {chatMessages.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => void handleClear()} disabledReason={isGenerating ? "Erst die Antwort abwarten" : undefined}>
            <Trash2 aria-hidden /> Verlauf löschen
          </Button>
        ) : null}
      </div>

      <div
        role="group"
        aria-label="Schnellaktionen"
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&>*]:shrink-0"
      >
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            onClick={() => sendMessage(action.prompt)}
            disabledReason={isGenerating ? "Erst die Antwort abwarten" : undefined}
          >
            <Wand2 aria-hidden className="size-3.5" /> {quickActionLabel(action.label)}
          </Button>
        ))}
      </div>

      <div className="flex h-[min(60dvh,520px)] min-h-80 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div
          ref={scrollRef}
          role="region"
          aria-label="Verlauf"
          tabIndex={0}
          className="flex-1 space-y-3 overflow-y-auto p-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:p-4"
        >
          {chatMessages.length === 0 && !isGenerating ? (
            <p className="py-8 text-center text-ui text-muted-foreground">
              Nutze eine Schnellaktion oder schreib, was am Prompt besser werden soll.
            </p>
          ) : null}
          {chatMessages.map((msg, idx) => {
            const quick = msg.role === "user" ? QUICK_BY_PROMPT.get(msg.content) : undefined;
            return (
              <div
                key={idx}
                className={cn(
                  "max-w-[90%] rounded-lg px-3 py-2 text-sm md:max-w-[85%]",
                  msg.role === "user"
                    ? "ml-auto border border-primary-border bg-primary-subtle text-foreground"
                    : "border border-border bg-surface-2 text-foreground",
                )}
              >
                <span className="sr-only">{msg.role === "user" ? "Du: " : "KI: "}</span>
                {quick ? (
                  <p className="flex items-center gap-1.5 font-medium">
                    <Wand2 aria-hidden className="size-3.5 text-primary-text" /> {quick}
                  </p>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
                )}
              </div>
            );
          })}
          {isGenerating ? (
            <p className="flex items-center gap-2 text-ui text-muted-foreground">
              <Spinner /> Antwort wird erstellt …
            </p>
          ) : null}
        </div>
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>

        <form
          className="flex items-end gap-2 border-t border-border p-2.5 md:p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
        >
          <Field className="min-w-0 flex-1">
            <FieldLabel className="sr-only">Nachricht an die KI</FieldLabel>
            <Textarea
              autosize={{ min: 1, max: 6 }}
              placeholder="Was soll besser werden? z. B. „Kürzer und mit klarer Definition of Done“"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendMessage(input);
                }
              }}
            />
          </Field>
          <IconButton
            type="submit"
            aria-label="Senden"
            variant="primary"
            size="icon-lg"
            disabledReason={isGenerating ? "Erst die Antwort abwarten" : !input.trim() ? "Erst eine Nachricht eingeben" : undefined}
          >
            <Send />
          </IconButton>
        </form>
      </div>

      <StepFooter>
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft aria-hidden /> Zurück: Vorschau
        </Button>
      </StepFooter>
    </section>
  );
}
