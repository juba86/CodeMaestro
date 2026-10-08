import { describe, expect, it } from "vitest";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import type { PromptStructured } from "@/lib/ai/types";
import { applyDraftChange, syncedStructured, xmlNeedsRebuild } from "./xml-sync";

const FIELDS: PromptStructured = {
  instructions: "Behebe den Fehler in der Login-Route.",
  context: "Next.js 16",
  constraints: "",
  examples: [],
  task: "Fehler beheben",
  targetAudience: "",
  outputFormat: "",
};

describe("xmlNeedsRebuild", () => {
  const built = buildXml(FIELDS);
  const handEdited = built.replace("Next.js 16", "Next.js 16, Prisma");

  it("keeps a hand-edited XML while the fields are unchanged", () => {
    expect(xmlNeedsRebuild(handEdited, FIELDS, built)).toBe(false);
  });

  it("rebuilds once the fields changed", () => {
    expect(xmlNeedsRebuild(handEdited, { ...FIELDS, task: "Anders" }, built)).toBe(true);
  });

  it("rebuilds an empty XML or when the basis is unknown", () => {
    expect(xmlNeedsRebuild("", FIELDS, built)).toBe(true);
    expect(xmlNeedsRebuild(handEdited, FIELDS, null)).toBe(true);
  });
});

describe("applyDraftChange", () => {
  it("changes only the fields outside the XML steps", () => {
    const r = applyDraftChange({ structured: FIELDS, xmlContent: "", xmlStep: false }, () => ({ technique: "verification-loop" }));
    expect(r?.structured.technique).toBe("verification-loop");
    expect(r?.xml).toBeNull();
  });

  it("applies the change on top of a hand-edited XML on the XML steps", () => {
    const handEdited = buildXml(FIELDS).replace("Next.js 16", "Next.js 16, Prisma");
    const r = applyDraftChange({ structured: FIELDS, xmlContent: handEdited, xmlStep: true }, (cur) => ({
      constraints: `${cur.constraints}Keine Tests löschen.`,
    }));
    expect(r?.structured.context).toBe("Next.js 16, Prisma");
    expect(r?.xml).toContain("Next.js 16, Prisma");
    expect(r?.xml).toContain("<constraints>Keine Tests löschen.</constraints>");
  });

  it("returns null when the change declines", () => {
    expect(applyDraftChange({ structured: FIELDS, xmlContent: "", xmlStep: true }, () => null)).toBeNull();
  });
});

describe("syncedStructured", () => {
  it("returns null for XML without prompt tags", () => {
    expect(syncedStructured("nur Text", FIELDS)).toBeNull();
  });

  it("keeps the technique when the XML does not name one", () => {
    const next = syncedStructured("<task>Neu</task>", { ...FIELDS, technique: "verification-loop" });
    expect(next?.task).toBe("Neu");
    expect(next?.technique).toBe("verification-loop");
  });
});
