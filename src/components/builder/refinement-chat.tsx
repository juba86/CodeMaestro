"use client";

import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { REFINEMENT_SYSTEM_PROMPT, QUICK_ACTIONS } from "@/lib/prompt-engine/refinement-prompts";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { decryptApiKey } from "@/lib/ai/crypto";
import type { ProviderName } from "@/lib/ai/types";
import { useState, useRef, useEffect } from "react";
import { Send, Wand2 } from "lucide-react";
import { toast } from "sonner";

export function RefinementChat() {
  const {
    xmlContent, setXmlContent, chatMessages, addChatMessage,
    isGenerating, setIsGenerating, updateStructured, setStep,
  } = useBuilderStore();
  const { activeProvider, activeModel } = useSettingsStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  async function getApiKey(provider: ProviderName): Promise<string> {
    const enc = localStorage.getItem(`pb-apikey-${provider}`);
    if (enc) {
      try { return await decryptApiKey(enc); } catch { /* fallback */ }
    }
    return "";
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isGenerating) return;

    const userMsg = `Current prompt XML:\n\`\`\`xml\n${xmlContent}\n\`\`\`\n\n${text}`;
    addChatMessage({ role: "user", content: text });
    setInput("");
    setIsGenerating(true);

    // Abort previous request if still running
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Timeout after 30 seconds
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Load API key from encrypted localStorage
      const apiKey = await getApiKey(activeProvider);

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userMsg },
          ],
          systemPrompt: REFINEMENT_SYSTEM_PROMPT,
          provider: activeProvider,
          model: activeModel,
          stream: true,
          apiKey,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      let fullResponse = "";
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) fullResponse += parsed.content;
            } catch { /* skip invalid JSON */ }
          }
        }
      }

      addChatMessage({ role: "assistant", content: fullResponse });

      // Try to extract XML from response - broader pattern matching
      const xmlMatch = fullResponse.match(/<instructions>[\s\S]*?<\/task>/) ||
                       fullResponse.match(/<instructions>[\s\S]*<\/instructions>/);
      if (xmlMatch) {
        const newXml = xmlMatch[0];
        setXmlContent(newXml);
        updateStructured(parseXml(newXml));
        toast.success("Prompt updated from AI suggestion");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("Request timed out or was cancelled.");
      } else {
        toast.error("Chat failed. Check your API key.");
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
