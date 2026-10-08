import { describe, expect, it } from "vitest";
import {
  AI_APPS,
  MAX_PREFILL_URL_LENGTH,
  appLaunch,
  launchHint,
  launchToast,
  prefillUrl,
  tooLongForPrefill,
  type AiApp,
  type AiAppId,
} from "./ai-apps";

const app = (id: AiAppId): AiApp => {
  const found = AI_APPS.find((a) => a.id === id);
  if (!found) throw new Error(`missing app ${id}`);
  return found;
};

describe("AI_APPS", () => {
  it("lists ChatGPT, Claude and Gemini first, with unique ids and https URLs", () => {
    expect(AI_APPS.slice(0, 3).map((a) => a.id)).toEqual(["chatgpt", "claude", "gemini"]);
    expect(new Set(AI_APPS.map((a) => a.id)).size).toBe(AI_APPS.length);
    for (const a of AI_APPS) {
      expect(a.homeUrl).toMatch(/^https:\/\//);
      if (a.prefill) expect(a.prefill.base).toMatch(/^https:\/\//);
    }
  });

  it("marks only ChatGPT, Claude Code and Perplexity as verified, Gemini without prefill", () => {
    const verified = AI_APPS.filter((a) => a.prefill?.verified).map((a) => a.id);
    expect(verified).toEqual(["chatgpt", "claude-code", "perplexity"]);
    expect(app("gemini").prefill).toBeUndefined();
  });
});

describe("prefillUrl", () => {
  it("builds the documented URL shapes", () => {
    expect(prefillUrl(app("chatgpt"), "Hallo Welt")).toBe("https://chatgpt.com/?q=Hallo%20Welt");
    expect(prefillUrl(app("claude"), "Hallo")).toBe("https://claude.ai/new?q=Hallo");
    expect(prefillUrl(app("claude-code"), "Fix den Test")).toBe("https://claude.ai/code?prompt=Fix%20den%20Test");
    expect(prefillUrl(app("perplexity"), "a")).toBe("https://www.perplexity.ai/search?q=a");
    expect(prefillUrl(app("lechat"), "a")).toBe("https://chat.mistral.ai/chat?q=a");
    expect(prefillUrl(app("gemini"), "a")).toBeNull();
  });

  it("percent-encodes XML, umlauts, line breaks, & and + so the prompt survives intact", () => {
    const prompt = '<task id="1">Grüße & 1+1\n</task>';
    const url = prefillUrl(app("chatgpt"), prompt)!;
    const query = url.slice("https://chatgpt.com/?q=".length);
    expect(query).not.toMatch(/[<>"\n &+]/);
    expect(new URL(url).searchParams.get("q")).toBe(prompt);
    expect(decodeURIComponent(query)).toBe(prompt);
  });

  it("returns null for text that cannot be encoded (lone surrogate)", () => {
    expect(prefillUrl(app("chatgpt"), "kaputt \uD800")).toBeNull();
  });
});

describe("appLaunch", () => {
  it("prefills a short prompt (trimmed) and passes the verified flag", () => {
    expect(appLaunch(app("chatgpt"), "  Erkläre Closures  ")).toEqual({
      url: "https://chatgpt.com/?q=Erkl%C3%A4re%20Closures",
      prefilled: true,
      verified: true,
    });
    expect(appLaunch(app("claude"), "x")).toMatchObject({ prefilled: true, verified: false });
  });

  it("opens the start page for apps without prefill", () => {
    expect(appLaunch(app("gemini"), "x")).toEqual({ url: "https://gemini.google.com/app", prefilled: false, reason: "unsupported" });
  });

  it("opens the start page for an empty prompt", () => {
    expect(appLaunch(app("chatgpt"), "  \n ")).toEqual({ url: "https://chatgpt.com/", prefilled: false, reason: "empty" });
  });

  it("opens the start page when the prompt cannot be encoded", () => {
    expect(appLaunch(app("claude"), "\uDC00")).toEqual({ url: "https://claude.ai/new", prefilled: false, reason: "encoding" });
  });

  it("guards the URL length, counting the encoded form", () => {
    const base = "https://chatgpt.com/?q=";
    const fits = "a".repeat(MAX_PREFILL_URL_LENGTH - base.length);
    expect(appLaunch(app("chatgpt"), fits)).toMatchObject({ prefilled: true });
    expect(appLaunch(app("chatgpt"), `${fits}a`)).toEqual({ url: "https://chatgpt.com/", prefilled: false, reason: "too-long" });
    // "<" encodes to three characters, so far fewer of them fit.
    const brackets = "<".repeat(Math.ceil((MAX_PREFILL_URL_LENGTH - base.length) / 3) + 1);
    expect(appLaunch(app("chatgpt"), brackets)).toMatchObject({ prefilled: false, reason: "too-long" });
  });

  it("takes a custom limit", () => {
    expect(appLaunch(app("chatgpt"), "Hallo", 20)).toMatchObject({ prefilled: false, reason: "too-long" });
    expect(appLaunch(app("chatgpt"), "Hallo", 40)).toMatchObject({ prefilled: true });
  });
});

describe("tooLongForPrefill", () => {
  it("is true only when every prefill app would have to fall back", () => {
    expect(tooLongForPrefill("kurz")).toBe(false);
    expect(tooLongForPrefill("x".repeat(MAX_PREFILL_URL_LENGTH))).toBe(true);
    expect(tooLongForPrefill("")).toBe(false);
  });
});

describe("launchHint", () => {
  it("tells apart prefilled, best effort, too long and paste", () => {
    expect(launchHint(appLaunch(app("chatgpt"), "x"))).toBe("Prompt wird eingefügt");
    expect(launchHint(appLaunch(app("claude"), "x"))).toBe("Prompt wird übergeben, sonst einfügen");
    expect(launchHint(appLaunch(app("chatgpt"), "x".repeat(MAX_PREFILL_URL_LENGTH)))).toBe("Zu lang für den Link – einfügen");
    expect(launchHint(appLaunch(app("gemini"), "x"))).toBe("Prompt einfügen");
  });
});

describe("launchToast", () => {
  const long = "x".repeat(MAX_PREFILL_URL_LENGTH);

  it("asks to paste when the prompt is too long or the app has no prefill", () => {
    expect(launchToast(app("chatgpt"), appLaunch(app("chatgpt"), long), true)).toEqual({
      tone: "success",
      message: "Prompt kopiert – in ChatGPT einfügen",
    });
    expect(launchToast(app("gemini"), appLaunch(app("gemini"), "x"), true).message).toBe("Prompt kopiert – in Gemini einfügen");
  });

  it("confirms a verified prefill and hedges a best-effort one", () => {
    expect(launchToast(app("chatgpt"), appLaunch(app("chatgpt"), "x"), true).message).toMatch(/^Prompt an ChatGPT übergeben/);
    expect(launchToast(app("claude"), appLaunch(app("claude"), "x"), true).message).toMatch(/falls er nicht schon in Claude steht/);
  });

  it("reports a failed copy: info when the link still carries the prompt, error otherwise", () => {
    expect(launchToast(app("chatgpt"), appLaunch(app("chatgpt"), "x"), false).tone).toBe("info");
    expect(launchToast(app("gemini"), appLaunch(app("gemini"), "x"), false)).toMatchObject({ tone: "error" });
  });
});
