import { describe, expect, it } from "vitest";
import { HANDOFF_HEADING, buildHandoffContext, extractHandoff, handoffBudget, handoffNote, type HandoffEntry } from "./handoff";

describe("extractHandoff", () => {
  it("returns the text after the last handoff heading", () => {
    const text = `I looked around.\n\n${HANDOFF_HEADING}\n- old\n\nFixed more.\n\n## Handoff\n- changed src/a.ts\n- tests pass`;
    expect(extractHandoff(text)).toBe("- changed src/a.ts\n- tests pass");
  });

  it("accepts other heading levels and the German word", () => {
    expect(extractHandoff("x\n### Übergabe an den Coder\n- a")).toBe("- a");
    expect(extractHandoff("x\n# HANDOFF\n- b")).toBe("- b");
  });

  it("is null without a heading or with an empty section", () => {
    expect(extractHandoff("We discussed the handoff in prose.")).toBeNull();
    expect(extractHandoff("done\n## Handoff\n  ")).toBeNull();
  });
});

describe("handoffNote", () => {
  it("prefers the handoff section over the exploration before it", () => {
    const text = `${"reading files … ".repeat(500)}\n## Handoff\n- schema is in prisma/schema.prisma`;
    expect(handoffNote(text, 1000)).toBe("- schema is in prisma/schema.prisma");
  });

  it("falls back to the clipped output, keeping its end", () => {
    const text = `START ${"x".repeat(5000)} THE END`;
    const note = handoffNote(text, 400);
    expect(note.length).toBeLessThanOrEqual(400 + 5);
    expect(note.startsWith("START")).toBe(true);
    expect(note.endsWith("THE END")).toBe(true);
    expect(handoffNote("  ", 100)).toBe("");
  });
});

describe("handoffBudget", () => {
  it("follows the context window within bounds", () => {
    expect(handoffBudget(8192)).toBe(4000);
    expect(handoffBudget(32768)).toBe(15729);
    expect(handoffBudget(262144)).toBe(24000);
    expect(handoffBudget()).toBe(24000);
    expect(handoffBudget(0)).toBe(24000);
  });
});

const entry = (id: string, extra: Partial<HandoffEntry> = {}): HandoffEntry => ({
  id, title: `Title ${id}`, by: "Coder, pi · x", output: `work of ${id}\n## Handoff\n- result ${id}`, ...extra,
});

describe("buildHandoffContext", () => {
  it("is empty when nothing ran before", () => {
    expect(buildHandoffContext([], [], 8000)).toBe("");
  });

  it("hands over every earlier subtask, not only the declared dependencies", () => {
    const ctx = buildHandoffContext([entry("s1"), entry("s2")], ["s2"], 8000);
    expect(ctx).toContain("<previous_work>");
    expect(ctx).toContain('<subtask id="s1" title="Title s1" by="Coder, pi · x">');
    expect(ctx).toContain('<subtask id="s2" title="Title s2" by="Coder, pi · x" status="you build on this">');
    expect(ctx).toContain("- result s1");
    expect(ctx).toContain("- result s2");
    expect(ctx.indexOf("- result s1")).toBeLessThan(ctx.indexOf("- result s2"));
  });

  it("gives dependencies the detail and keeps the others brief", () => {
    const long = (id: string) => entry(id, { output: `${id} ${"y".repeat(20_000)}` });
    const ctx = buildHandoffContext([long("s1"), long("s2")], ["s2"], 8000);
    const size = (id: string) => ctx.split(`<subtask id="${id}"`)[1].split("</subtask>")[0].length;
    expect(size("s1")).toBeLessThan(900);
    expect(size("s2")).toBeGreaterThan(6000);
    expect(ctx.length).toBeLessThan(8000 + 1200);
  });

  it("states measured files, failures and the review outcome", () => {
    const ctx = buildHandoffContext(
      [entry("s1", { files: ["src/a.ts", "src/b.ts"], failed: true, review: "changes after 2 round(s)" })],
      [],
      8000
    );
    expect(ctx).toContain("Files changed: src/a.ts, src/b.ts\n");
    expect(ctx).toContain("ended with an error");
    expect(ctx).toContain("review: changes after 2 round(s)");
  });

  it("caps long file lists and neutralises markup in titles", () => {
    const files = Array.from({ length: 45 }, (_, i) => `f${i}.ts`);
    const ctx = buildHandoffContext([entry("s1", { files, title: 'A "quoted" <tag>' })], [], 8000);
    expect(ctx).toContain("… (+5 more)");
    expect(ctx).toContain('title="A  quoted   tag"');
  });
});
