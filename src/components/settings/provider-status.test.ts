import { describe, expect, it } from "vitest";
import { PROVIDERS, getProvider, type ProviderDef } from "@/lib/ai/catalog";
import { PROVIDER_LIST, isProviderConfigured, keyRequired, providerSummaryText, summarizeProviders, supportsLogin } from "./provider-status";

const def = (id: string): ProviderDef => {
  const d = getProvider(id);
  if (!d) throw new Error(`unknown provider ${id}`);
  return d;
};

describe("PROVIDER_LIST", () => {
  it("contains every catalog provider once, dedicated ones first and custom last", () => {
    expect(PROVIDER_LIST).toHaveLength(PROVIDERS.length);
    expect(new Set(PROVIDER_LIST.map((p) => p.id)).size).toBe(PROVIDERS.length);
    expect(PROVIDER_LIST[0].id).toBe("claude");
    expect(PROVIDER_LIST[PROVIDER_LIST.length - 1].id).toBe("custom");
  });
});

describe("isProviderConfigured", () => {
  it("counts a CLI login for claude and gemini", () => {
    expect(supportsLogin(def("claude"))).toBe(true);
    expect(isProviderConfigured(def("claude"), { hasKey: false, authMode: "oauth" })).toBe(true);
    expect(isProviderConfigured(def("gemini"), { hasKey: false, authMode: "key" })).toBe(false);
  });
  it("counts a stored key", () => {
    expect(isProviderConfigured(def("openai"), { hasKey: true })).toBe(true);
    expect(isProviderConfigured(def("openai"), { hasKey: false, active: true })).toBe(false);
  });
  it("needs a base URL for the custom endpoint", () => {
    expect(isProviderConfigured(def("custom"), { hasKey: false, baseUrl: "  " })).toBe(false);
    expect(isProviderConfigured(def("custom"), { hasKey: false, baseUrl: "http://localhost:8000/v1" })).toBe(true);
  });
  it("counts local servers once they are the active provider", () => {
    expect(keyRequired(def("ollama"))).toBe(false);
    expect(isProviderConfigured(def("ollama"), { hasKey: false })).toBe(false);
    expect(isProviderConfigured(def("ollama"), { hasKey: false, active: true })).toBe(true);
    expect(isProviderConfigured(def("lmstudio"), { hasKey: false, active: true })).toBe(true);
  });
});

describe("summarizeProviders", () => {
  it("lists configured ids in display order", () => {
    const s = summarizeProviders(PROVIDER_LIST, (d) => ({ hasKey: d.id === "groq" || d.id === "openai", authMode: d.id === "claude" ? "oauth" : "key" }));
    expect(s.ids).toEqual(["claude", "openai", "groq"]);
    expect(s.configured).toBe(3);
    expect(s.total).toBe(PROVIDERS.length);
    expect(providerSummaryText(s)).toBe(`3 von ${PROVIDERS.length} eingerichtet`);
  });
});
