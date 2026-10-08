import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_MESSAGES,
  canAskFollowUp,
  chatErrorMessage,
  historyForApi,
  isSettingsError,
  openingPrompt,
  type ChatTurn,
  type TurnStatus,
} from "./chat-turns";

let n = 0;
const q = (content: string): ChatTurn => ({ id: `u${++n}`, role: "user", content });
const a = (content: string, status: TurnStatus = "done"): ChatTurn => ({
  id: `a${++n}`,
  role: "assistant",
  content,
  status,
  provider: "claude",
  model: "claude-opus-5-5",
});

describe("historyForApi", () => {
  it("returns complete exchanges in order, as plain role/content messages", () => {
    expect(historyForApi([q("Prompt"), a("Antwort 1"), q("Warum?"), a("Darum.")])).toEqual([
      { role: "user", content: "Prompt" },
      { role: "assistant", content: "Antwort 1" },
      { role: "user", content: "Warum?" },
      { role: "assistant", content: "Darum." },
    ]);
  });

  it("drops exchanges without an answer (error, stopped early, empty)", () => {
    const turns = [q("Prompt"), a("", "error"), q("Nochmal"), a("Teil", "stopped"), q("Und?"), a("  ", "done")];
    expect(historyForApi(turns)).toEqual([
      { role: "user", content: "Nochmal" },
      { role: "assistant", content: "Teil" },
    ]);
  });

  it("keeps a partial answer that ended with a stream error", () => {
    expect(historyForApi([q("P"), a("halbe Antwort", "error")])).toHaveLength(2);
  });

  it("leaves out the exchange still streaming and a trailing question", () => {
    expect(historyForApi([q("P"), a("läuft …", "streaming")])).toEqual([]);
    expect(historyForApi([q("P"), a("A"), q("offen")])).toHaveLength(2);
  });

  it("never yields two messages of the same role in a row", () => {
    const turns = [q("1"), a("", "error"), q("2"), a("B"), q("3"), a("", "stopped"), q("4"), a("D")];
    const roles = historyForApi(turns).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("canAskFollowUp", () => {
  it("allows a question while history + question fit into one request", () => {
    const pairs = (count: number) => Array.from({ length: count }, (_, i) => [q(`F${i}`), a(`A${i}`)]).flat();
    const max = Math.floor((MAX_CHAT_MESSAGES - 1) / 2);
    expect(canAskFollowUp(pairs(max))).toBe(true);
    expect(canAskFollowUp(pairs(max + 1))).toBe(false);
    expect(canAskFollowUp([])).toBe(true);
  });
});

describe("openingPrompt", () => {
  it("is the first question, or null", () => {
    expect(openingPrompt([q("<prompt/>"), a("A"), q("F")])).toBe("<prompt/>");
    expect(openingPrompt([])).toBeNull();
  });
});

describe("chatErrorMessage", () => {
  it("translates the missing key and base URL errors and points to the settings", () => {
    const raw = "No API key configured. Set it in Settings.";
    expect(chatErrorMessage(raw, "OpenAI")).toBe(
      "Kein API-Schlüssel für OpenAI hinterlegt. Trag ihn in den Einstellungen unter „Provider“ ein.",
    );
    expect(isSettingsError(raw)).toBe(true);
    expect(chatErrorMessage("A valid http(s) base URL is required for this provider.", "Eigener Endpunkt")).toMatch(
      /^Für Eigener Endpunkt fehlt eine gültige Basis-URL/,
    );
  });

  it("names network failures and keeps provider messages as they are", () => {
    expect(chatErrorMessage("Failed to fetch", "Claude")).toBe("Keine Verbindung zum Server.");
    expect(chatErrorMessage("model not found: gpt-9", "OpenAI")).toBe("model not found: gpt-9");
    expect(isSettingsError("model not found")).toBe(false);
    expect(chatErrorMessage("  ", "OpenAI")).toBe("Anfrage fehlgeschlagen.");
  });
});
