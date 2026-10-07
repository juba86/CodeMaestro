"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildRefinementSystemPrompt, QUICK_ACTIONS } from "@/lib/prompt-engine/refinement-prompts";
import { getModelProfile } from "@/lib/prompt-engine/model-profile";
import { parseXmlPartial, PROMPT_TAGS, tagPattern } from "@/lib/prompt-engine/xml-parser";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Wand2 } from "lucide-react";
import { toast } from "sonner";

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

export function RefinementChat() {
  const {
    xmlContent, setXmlContent, chatMessages, addChatMessage,
    isGenerating, setIsGenerating, updateStructured, setStep,
  } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  // The prompt is refined for the active model, as the quality panel lints it.
  const systemPrompt = useMemo(
    () => buildRefinementSystemPrompt(getModelProfile(activeProvider, activeModel)),
    [activeProvider, activeModel]
  );
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

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
        throw new Error(typeof e?.error === "string" ? e.error : `Chat request failed (HTTP ${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

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
            streamError = parsed.content || "Stream error";
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

      if (streamError) toast.error(`AI error: ${streamError}`);
      if (!fullResponse.trim()) {
        if (!streamError) toast.error("The AI returned an empty reply.");
        return;
      }

      addChatMessage({ role: "assistant", content: fullResponse });

      // Only apply a complete prompt, and merge it: sections the reply leaves
      // out (e.g. the technique, which models rarely echo) keep their values.
      const newXml = extractPromptXml(fullResponse);
      if (newXml) {
        updateStructured(parseXmlPartial(newXml));
        setXmlContent(buildXml(useBuilderStore.getState().structured));
        toast.success("Prompt updated from AI suggestion");
      } else if (completeTagsIn(fullResponse).size > 0) {
        toast.info("The reply only contains a partial XML snippet — not applied automatically.");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("Request timed out or was cancelled.");
      } else {
        toast.error(err instanceof Error ? `Chat failed: ${err.message}` : "Chat failed. Check your API key.");
        console.error(err);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Refine with AI</h2>
        <button
          onClick={() => setStep("preview")}
          className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent"
        >
          Back to Preview
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => sendMessage(action.prompt)}
            disabled={isGenerating}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent disabled:opacity-50"
          >
            <Wand2 size={12} /> {action.label}
          </button>
        ))}
      </div>

      <div className="border border-border rounded-lg h-[400px] flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chatMessages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Use quick actions or type a message to refine your prompt.
            </p>
          )}
          {chatMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                msg.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-accent"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
            </div>
          ))}
          {isGenerating && (
            <div className="text-sm text-muted-foreground animate-pulse">Thinking...</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-3 flex gap-2">
          <input
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Ask for improvements..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
            disabled={isGenerating}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isGenerating || !input.trim()}
            className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
