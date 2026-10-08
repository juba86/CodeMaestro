import { describe, expect, it } from "vitest";
import { builtInTemplates } from "@/lib/templates/built-in";
import { TEMPLATE_CATEGORY_LABEL, TEMPLATE_CATEGORY_ORDER, TEMPLATE_DE, categoryLabel } from "./template-labels";

describe("template labels", () => {
  it("has German copy for every built-in template", () => {
    for (const t of builtInTemplates) expect(TEMPLATE_DE[t.slug], t.slug).toBeDefined();
  });

  it("labels and orders every built-in category, agentic coding first", () => {
    const cats = new Set(builtInTemplates.map((t) => t.category));
    expect(cats.has("agentic-coding")).toBe(true);
    for (const c of cats) {
      expect(TEMPLATE_CATEGORY_LABEL[c], c).toBeDefined();
      expect(TEMPLATE_CATEGORY_ORDER).toContain(c);
    }
    expect(TEMPLATE_CATEGORY_ORDER[0]).toBe("agentic-coding");
    expect(categoryLabel("agentic-coding")).toBe("Agentisches Coding");
  });

  it("names unknown categories readably", () => {
    expect(categoryLabel("data-science")).toBe("Data science");
    expect(categoryLabel("")).toBe("Sonstige");
  });
});
