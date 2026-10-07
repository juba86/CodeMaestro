import { describe, expect, it } from "vitest";
import type { DiffPart } from "@/lib/assistant/approvals";
import { diffStats, toDiffLines, type DiffCollapsedRow, type DiffLineRow, type DiffRow } from "./diff-view";

const eq = (text: string): DiffPart => ({ op: "equal", text });
const add = (text: string): DiffPart => ({ op: "add", text });
const del = (text: string): DiffPart => ({ op: "del", text });
const equalLines = (n: number, prefix = "l") => Array.from({ length: n }, (_, k) => eq(`${prefix}${k + 1}`));

const lines = (rows: DiffRow[]) => rows.filter((r): r is DiffLineRow => r.kind === "line");
const hunks = (rows: DiffRow[]) => rows.filter((r): r is DiffCollapsedRow => r.kind === "collapsed");
const shape = (rows: DiffRow[]) =>
  rows.map((r) => (r.kind === "collapsed" ? `…${r.lines.length}` : `${r.op[0]}:${r.text}`));

describe("toDiffLines numbering", () => {
  it("numbers old and new lines independently", () => {
    const rows = toDiffLines([eq("a"), del("b"), add("B"), add("C"), eq("d")]);
    expect(rows).toEqual([
      { kind: "line", op: "equal", text: "a", oldNo: 1, newNo: 1 },
      { kind: "line", op: "del", text: "b", oldNo: 2, newNo: null },
      { kind: "line", op: "add", text: "B", oldNo: null, newNo: 2 },
      { kind: "line", op: "add", text: "C", oldNo: null, newNo: 3 },
      { kind: "line", op: "equal", text: "d", oldNo: 3, newNo: 4 },
    ]);
  });

  it("splits multi-line parts into rows", () => {
    const rows = lines(toDiffLines([eq("a\nb"), add("x\ny\nz"), del("q")]));
    expect(rows.map((r) => [r.op, r.text, r.oldNo, r.newNo])).toEqual([
      ["equal", "a", 1, 1],
      ["equal", "b", 2, 2],
      ["add", "x", null, 3],
      ["add", "y", null, 4],
      ["add", "z", null, 5],
      ["del", "q", 3, null],
    ]);
  });

  it("treats one trailing newline as a line terminator, keeps empty lines", () => {
    expect(lines(toDiffLines([add("x\ny\n")])).map((r) => r.text)).toEqual(["x", "y"]);
    expect(lines(toDiffLines([add("x\n\n")])).map((r) => r.text)).toEqual(["x", ""]);
    expect(lines(toDiffLines([eq(""), add("a")])).map((r) => r.text)).toEqual(["", "a"]);
  });

  it("handles empty input", () => {
    expect(toDiffLines([])).toEqual([]);
  });
});

describe("toDiffLines collapsing", () => {
  it("collapses a long middle run, keeping context on both sides", () => {
    const rows = toDiffLines([add("A"), ...equalLines(20), add("B")]);
    expect(shape(rows)).toEqual(["a:A", "e:l1", "e:l2", "e:l3", "…14", "e:l18", "e:l19", "e:l20", "a:B"]);
    const [hunk] = hunks(rows);
    expect(hunk.lines[0]).toMatchObject({ text: "l4", oldNo: 4, newNo: 5 });
    expect(hunk.lines.every((l) => l.op === "equal")).toBe(true);
  });

  it("keeps only the context towards the change for leading and trailing runs", () => {
    const rows = toDiffLines([...equalLines(10), del("x"), ...equalLines(10, "t")]);
    expect(shape(rows)).toEqual(["…7", "e:l8", "e:l9", "e:l10", "d:x", "e:t1", "e:t2", "e:t3", "…7"]);
  });

  it("does not collapse runs of collapseOver lines or fewer", () => {
    const rows = toDiffLines([add("A"), ...equalLines(6), add("B")]);
    expect(hunks(rows)).toHaveLength(0);
    expect(lines(rows)).toHaveLength(8);
  });

  it("never hides fewer than 2 lines", () => {
    // 7 lines in the middle: 3 + 3 context leaves only 1 to hide → shown in full.
    expect(hunks(toDiffLines([add("A"), ...equalLines(7), add("B")]))).toHaveLength(0);
    // 8 lines: 2 hidden.
    const rows = toDiffLines([add("A"), ...equalLines(8), add("B")]);
    expect(hunks(rows).map((h) => h.lines.length)).toEqual([2]);
  });

  it("respects context and collapseOver options", () => {
    const rows = toDiffLines([add("A"), ...equalLines(10), add("B")], { context: 1, collapseOver: 2 });
    expect(shape(rows)).toEqual(["a:A", "e:l1", "…8", "e:l10", "a:B"]);
    const none = toDiffLines([add("A"), ...equalLines(10), add("B")], { context: 0, collapseOver: 100 });
    expect(hunks(none)).toHaveLength(0);
  });

  it("keeps the first lines of a file without changes", () => {
    const rows = toDiffLines(equalLines(31));
    expect(shape(rows)).toEqual(["e:l1", "e:l2", "e:l3", "…28"]);
  });

  it("collapses the 31 unchanged lines of the mockup", () => {
    const rows = toDiffLines([eq("import a"), add("x"), ...equalLines(34)]);
    expect(hunks(rows).map((h) => h.lines.length)).toEqual([31]);
  });

  it("gives hunks unique ids", () => {
    const rows = toDiffLines([...equalLines(10), add("x"), ...equalLines(10, "m"), add("y"), ...equalLines(10, "t")]);
    const ids = hunks(rows).map((h) => h.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("diffStats", () => {
  it("counts added and removed lines", () => {
    expect(diffStats([eq("a"), add("b\nc"), del("d"), add("e\n")])).toEqual({ added: 3, removed: 1 });
  });
});
