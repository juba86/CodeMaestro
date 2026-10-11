import { describe, expect, it } from "vitest";
import { repeatedTail } from "./runaway";

describe("repeatedTail", () => {
  it("finds the loop of a tool-less model faking tool calls", () => {
    const unit = "<tool_call>Bash\ncommands appear below.";
    const text = `Ich lese zuerst den Plan, dann sammle ich die Systemdaten.${unit.repeat(12)}`;
    const found = repeatedTail(text);
    expect(found).not.toBeNull();
    expect(found!.length).toBe(unit.length);
  });

  it("finds a loop wherever the stream happens to be cut", () => {
    const text = "intro " + "The same sentence again and again. ".repeat(20);
    for (let cut = 0; cut < 30; cut++) expect(repeatedTail(text.slice(0, text.length - cut))).not.toBeNull();
  });

  it("ignores normal prose, code and short outputs", () => {
    expect(repeatedTail("")).toBeNull();
    expect(repeatedTail("kurz")).toBeNull();
    const prose = Array.from({ length: 60 }, (_, i) => `Schritt ${i}: Datei src/mod${i}.ts geprüft, ${i % 7} Befunde.`).join("\n");
    expect(repeatedTail(prose)).toBeNull();
    const code = Array.from({ length: 40 }, (_, i) => `  const v${i} = compute(${i});`).join("\n");
    expect(repeatedTail(code)).toBeNull();
  });

  it("ignores formatting: rules, table separators, blank lines", () => {
    expect(repeatedTail(`Titel\n${"-".repeat(400)}`)).toBeNull();
    expect(repeatedTail(`a\n${"| --- | --- | --- |\n".repeat(20)}`)).toBeNull();
    expect(repeatedTail(`text${"\n".repeat(300)}`)).toBeNull();
    expect(repeatedTail(`x ${"= ".repeat(200)}`)).toBeNull();
  });

  it("needs eight copies, not a handful", () => {
    const unit = "identical list item text\n";
    expect(repeatedTail(`start\n${unit.repeat(7)}`)).toBeNull();
    expect(repeatedTail(`start\n${unit.repeat(8)}`)).not.toBeNull();
  });
});
