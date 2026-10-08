import { describe, expect, it } from "vitest";
import { createChatStreamParser } from "./chat-stream";

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
