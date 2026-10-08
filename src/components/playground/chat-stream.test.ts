import { describe, expect, it, vi } from "vitest";
import { createChatStreamParser, streamChat } from "./chat-stream";

describe("chat stream parser", () => {
  it("joins content across chunk boundaries and stops at [DONE]", () => {
    const p = createChatStreamParser();
    expect(p.push('data: {"type":"text","content":"Hal')).toBe("");
    expect(p.push('lo"}\n\ndata: {"content":" Welt"}\r\n')).toBe("Hallo Welt");
    p.push("data: [DONE]\n\ndata: {\"content\":\"zu spät\"}\n");
    expect(p.state.done).toBe(true);
    expect(p.state.text).toBe("Hallo Welt");
  });

  it("records stream errors and skips junk", () => {
    const p = createChatStreamParser();
    p.push(": ping\nevent: x\ndata: not json\n");
    p.push('data: {"type":"error","content":"Quota"}\n');
    expect(p.state.error).toBe("Quota");
    expect(p.state.text).toBe("");
  });

  it("flushes a final line without newline", () => {
    const p = createChatStreamParser();
    p.push('data: {"content":"Ende"}');
    expect(p.end()).toBe("Ende");
    expect(p.state.text).toBe("Ende");
  });
});

describe("streamChat", () => {
  type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
  function sseResponse(body: string): Response {
    return new Response(new Blob([body]).stream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("sends the history before the prompt and streams the answer", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      sseResponse('data: {"content":"Dar"}\n\ndata: {"content":"um."}\n\ndata: [DONE]\n\n'),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const deltas: string[] = [];
      const res = await streamChat({
        provider: "openai",
        model: "gpt-4o",
        prompt: "Warum?",
        history: [
          { role: "user", content: "<prompt/>" },
          { role: "assistant", content: "Antwort" },
        ],
        apiKey: "k",
        baseUrl: "",
        onDelta: (t) => deltas.push(t),
      });
      expect(res).toEqual({ text: "Darum.", error: undefined });
      expect(deltas.at(-1)).toBe("Darum.");
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body.messages).toEqual([
        { role: "user", content: "<prompt/>" },
        { role: "assistant", content: "Antwort" },
        { role: "user", content: "Warum?" },
      ]);
      expect(body.stream).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends just the prompt without history", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => sseResponse("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await streamChat({ provider: "ollama", model: "qwen3", prompt: "Hallo", apiKey: "", baseUrl: "" });
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages).toEqual([{ role: "user", content: "Hallo" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
