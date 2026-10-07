import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import * as yaml from "js-yaml";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { EXPORT_FORMATS, exportPrompt, type ExportablePrompt } from "./prompt-exporter";

// Contents that historically broke one of the code exporters: quotes next to
// the Python delimiter, trailing backslashes, CR/NUL/tab, template-literal
// syntax, long backtick runs and non-ASCII text.
const CONTENTS = [
  'ends with quote"',
  'has """ triple',
  '""""',
  '"',
  "back\\slash at end\\",
  'a\\"""b',
  "multi\nline\r\nwith CR\rand\ttab and \x00 nul",
  "`backtick` and ${interp} and \\${x} and ```fence```",
  "",
  "unicode äöü — 😀",
  'mixed \\" " "" """ """" end""',
  "<instructions>\n  A & B < C\n</instructions>",
];
const META = [
  { title: 'Title with """ quotes"', description: 'Desc ending "' },
  { title: "Title */ closes comment", description: "Multi\nline */ desc" },
  { title: "Plain", description: "" },
];

const cases: ExportablePrompt[] = CONTENTS.flatMap((content) =>
  META.map((m) => ({
    ...m,
    content,
    structured: { instructions: content, examples: [] },
    tags: ["ai", "a,b"],
  }))
);

const label = (p: ExportablePrompt) => `${JSON.stringify(p.content)} / ${JSON.stringify(p.title)}`;

/** Transpiles the TS export and evaluates it as a CommonJS module. */
function evalTs(src: string): Record<string, unknown> {
  const out = ts.transpileModule(src, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  expect(out.diagnostics?.map((d) => d.messageText) ?? []).toEqual([]);
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", out.outputText)(mod, mod.exports);
  return mod.exports;
}

describe("exportPrompt", () => {
  it("uses the format's extension and a safe file name", () => {
    for (const f of EXPORT_FORMATS) {
      const { filename } = exportPrompt({ ...cases[0], title: "My Prompt / v2!" }, f.id);
      expect(filename).toBe(`my-prompt--v2.${f.ext}`);
    }
    expect(exportPrompt({ ...cases[0], title: "???" }, "text").filename).toBe("prompt.txt");
  });

  it("text export is the raw content", () => {
    for (const p of cases) expect(exportPrompt(p, "text").body).toBe(p.content);
  });

  it("JSON export parses back to the same prompt", () => {
    for (const p of cases) {
      expect(JSON.parse(exportPrompt(p, "json").body), label(p)).toEqual(p);
    }
  });

  it("YAML export loads back to the same prompt", () => {
    for (const p of cases) {
      expect(yaml.load(exportPrompt(p, "yaml").body), label(p)).toEqual(p);
    }
  });

  it("TypeScript export compiles and PROMPT equals the content", () => {
    for (const p of cases) {
      const src = exportPrompt(p, "typescript").body;
      const mod = evalTs(src);
      expect(mod.PROMPT, label(p)).toBe(p.content);
      expect((mod.buildPrompt as (s: string) => string)("x")).toBe(`${p.content}\n\nUser Input: x`);
      // The JSDoc header must not be closed by the title or description.
      expect(src.indexOf("*/"), label(p)).toBe(src.indexOf(" */\nexport const PROMPT") + 1);
    }
  });

  it("Markdown export fences the content with a fence it cannot close", () => {
    for (const p of cases) {
      const md = exportPrompt(p, "markdown").body;
      const fence = md.match(/^(`{3,})xml$/m)?.[1];
      expect(fence, label(p)).toBeDefined();
      const lines = p.content.split(/\r\n|\r|\n/);
      expect(lines.some((l) => l.startsWith(fence!)), label(p)).toBe(false);
      expect(md.startsWith(`# ${p.title}`)).toBe(true);
    }
  });

  describe("Python export", () => {
    it("never lets the content form or touch a closing triple quote", () => {
      for (const p of cases) {
        const py = exportPrompt(p, "python").body;
        const m = py.match(/^PROMPT = """([\s\S]*)"""\n\n\ndef build_prompt\(/m);
        expect(m, label(p)).not.toBeNull();
        const inner = m![1];
        // Remove escape sequences; what's left must not contain a bare quote
        // run that could end the string early, nor raw CR / NUL.
        const unescaped = inner.replace(/\\[\s\S]/g, "");
        expect(unescaped.includes('""'), label(p)).toBe(false);
        expect(unescaped.endsWith('"'), label(p)).toBe(false);
        expect(/[\r\x00]/.test(inner), label(p)).toBe(false);
      }
    });

    const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
    const dir = mkdtempSync(path.join(tmpdir(), "cm-export-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it.skipIf(python.status !== 0)("runs under python3 and round-trips PROMPT and the docstring", () => {
      const files = cases.map((p, i) => {
        const file = path.join(dir, `p${i}.py`);
        writeFileSync(file, exportPrompt(p, "python").body);
        return file;
      });
      // One interpreter for all cases: prints [PROMPT, __doc__, build_prompt("x")] per file.
      const script = [
        "import json, runpy, sys",
        "out = []",
        "for f in sys.argv[1:]:",
        "    m = runpy.run_path(f)",
        "    out.append([m['PROMPT'], m['__doc__'], m['build_prompt']('x')])",
        "print(json.dumps(out))",
      ].join("\n");
      const r = spawnSync("python3", ["-I", "-c", script, ...files], { encoding: "utf8" });
      expect(r.stderr).toBe("");
      const results = JSON.parse(r.stdout) as [string, string, string][];
      cases.forEach((p, i) => {
        const [prompt, doc, built] = results[i];
        expect(prompt, label(p)).toBe(p.content);
        expect(doc, label(p)).toBe(`${p.title}${p.description ? `\n\n${p.description}` : ""}\n`);
        expect(built, label(p)).toBe(`${p.content}\n\nUser Input: x`);
      });
    });
  });
});
