import { describe, expect, it } from "vitest";
import { row } from "./meta";
import {
  actionCount,
  formatToolDuration,
  headLines,
  pairToolCalls,
  tailLines,
  toolGroup,
  toolTarget,
  touchedFiles,
  verbSummary,
} from "./tool-calls";
import type { Msg } from "./types";

const use = (name: string, input: unknown, toolUseId?: string, at?: number): Msg =>
  row({ role: "tool_use", content: name, at }, { name, input, toolUseId });
const res = (toolUseId: string | undefined, content: string, isError = false, at?: number): Msg =>
  row({ role: "tool_result", content, at }, { toolUseId, isError });
const rows = (msgs: Msg[], live = false) => msgs.map((msg, i) => ({ msg, key: `k${i}`, live }));

describe("toolTarget", () => {
  const cwd = "/home/u/proj";
  it("shows paths relative to the project folder", () => {
    expect(toolTarget("Read", { file_path: "/home/u/proj/src/a.ts" }, cwd)).toBe("src/a.ts");
    expect(toolTarget("Write", { file_path: "/etc/hosts" }, cwd)).toBe("/etc/hosts");
    expect(toolTarget("edit", { path: "/home/u/proj/b.ts" }, cwd)).toBe("b.ts");
  });
  it("describes searches, commands and web calls", () => {
    expect(toolTarget("Grep", { pattern: "Date.now", path: "/home/u/proj/src" }, cwd)).toBe('"Date.now" in src');
    expect(toolTarget("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(toolTarget("Bash", { command: "npm test -- auth" })).toBe("npm test -- auth");
    expect(toolTarget("Bash", { command: "cat <<EOF\nx\nEOF" })).toBe("cat <<EOF …");
    expect(toolTarget("WebFetch", { url: "https://x.dev" })).toBe("https://x.dev");
    expect(toolTarget("TodoWrite", { todos: [1, 2] })).toBe("2 Aufgaben");
    expect(toolTarget("Mystery", { foo: "bar\nbaz" })).toBe("bar");
    expect(toolTarget("Mystery", null)).toBe("");
  });
});

describe("pairToolCalls / toolGroup", () => {
  it("pairs results by id, falls back to the latest open call, and summarises", () => {
    const calls = pairToolCalls(
      rows([
        use("Read", { file_path: "a" }, "t1", 1000),
        use("Read", { file_path: "b" }, "t2", 1100),
        res("t2", "B", false, 1500),
        res("t1", "A", false, 1600),
        use("Grep", { pattern: "x" }, undefined, 2000),
        res(undefined, "hits", false, 2100),
        use("Bash", { command: "npm test" }, "t4", 3000),
        res("t4", "2 failed", true, 7200),
      ]),
    );
    expect(calls.map((c) => [c.label, c.status, c.result?.content])).toEqual([
      ["Lesen", "ok", "A"],
      ["Lesen", "ok", "B"],
      ["Suchen", "ok", "hits"],
      ["Befehl", "error", "2 failed"],
    ]);
    const g = toolGroup(calls);
    expect(g.verbs).toBe("Lesen ×2 · Suchen · Befehl");
    expect(g.errorCount).toBe(1);
    expect(g.durationMs).toBe(6200);
    expect(formatToolDuration(g.durationMs!)).toBe("6,2 s");
    expect(actionCount(calls.length)).toBe("4 Aktionen");
  });

  it("marks calls of a running run as running and leaves duration unknown", () => {
    const calls = pairToolCalls(rows([use("Read", { file_path: "a" }, "t1")], true));
    expect(calls[0].status).toBe("running");
    const g = toolGroup(calls);
    expect(g.running).toBe(true);
    expect(g.durationMs).toBeUndefined();
    // Persisted rows without a result have no status icon.
    expect(pairToolCalls(rows([use("Read", {}, "t1")]))[0].status).toBe("none");
  });

  it("keeps a result without its call as its own row", () => {
    const calls = pairToolCalls(rows([res("zz", "orphan")]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ label: "Ergebnis", status: "ok" });
  });

  it("labels pi's lower-case tools in German", () => {
    expect(verbSummary(pairToolCalls(rows([use("bash", { command: "ls" }), use("read", { path: "x" })])))).toBe("Befehl · Lesen");
  });
});

describe("text helpers", () => {
  it("formats durations above a minute as m:ss", () => {
    expect(formatToolDuration(61_400)).toBe("1:01");
    expect(formatToolDuration(-1)).toBe("");
  });
  it("cuts heads and tails", () => {
    expect(tailLines("1\n2\n3\n4\n", 2)).toEqual({ text: "3\n4", hidden: 2 });
    expect(headLines("1\n2\n3", 5)).toEqual({ text: "1\n2\n3", hidden: 0 });
    expect(headLines("1\n2\n3", 1)).toEqual({ text: "1", hidden: 2 });
  });
});

describe("touchedFiles", () => {
  it("lists edited and new files with counts", () => {
    const files = touchedFiles(
      rows([
        use("Read", { file_path: "/p/a.ts" }),
        use("Write", { file_path: "/p/a.ts", content: "" }),
        use("Edit", { file_path: "/p/b.ts" }),
        use("Edit", { file_path: "/p/b.ts" }),
        use("Write", { file_path: "/p/new.ts", content: "" }),
        use("Bash", { command: "rm x" }),
      ]),
      "/p",
    );
    expect(files.map((f) => [f.display, f.kind, f.count, f.lastKey])).toEqual([
      ["a.ts", "M", 1, "k1"],
      ["b.ts", "M", 2, "k3"],
      ["new.ts", "A", 1, "k4"],
    ]);
  });
});
