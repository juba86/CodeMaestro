import * as yaml from "js-yaml";

export type ExportFormat = "text" | "json" | "yaml" | "python" | "typescript" | "markdown";

export interface ExportablePrompt {
  title: string;
  description: string;
  content: string; // XML
  structured: Record<string, unknown>;
  tags: string[];
}

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string }[] = [
  { id: "text", label: "Plain text (.txt)", ext: "txt" },
  { id: "markdown", label: "Markdown (.md)", ext: "md" },
  { id: "json", label: "JSON (.json)", ext: "json" },
  { id: "yaml", label: "YAML (.yaml)", ext: "yaml" },
  { id: "python", label: "Python (.py)", ext: "py" },
  { id: "typescript", label: "TypeScript (.ts)", ext: "ts" },
];

function slug(title: string): string {
  return (title || "prompt").replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "prompt";
}

/**
 * Escapes text for the inside of a Python triple-quoted string. Backslashes
 * are doubled and a quote is escaped whenever another quote or the closing
 * delimiter follows it, so the text can never form or touch a `"""` — this
 * also covers content ending in `"`. CR and control characters are escaped
 * (Python would turn a raw CR into LF and rejects NUL in source).
 */
function pyEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"(?="|$)/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** Escapes text for a JS template literal (CR escaped: literals normalise it to LF). */
function tsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/\r/g, "\\r");
}

/** Renders text as ` * `-prefixed JSDoc lines that can't close the comment early. */
function jsDocLines(s: string): string[] {
  return s.replace(/\*\//g, "*\\/").split(/\r\n|\r|\n/).map((l) => (l ? ` * ${l}` : " *"));
}

/** A code fence longer than any backtick run inside the content. */
function mdFence(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) || []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function exportPrompt(p: ExportablePrompt, format: ExportFormat): { body: string; filename: string; mime: string } {
  const name = slug(p.title);
  const fmt = EXPORT_FORMATS.find((f) => f.id === format)!;
  let body: string;
  let mime = "text/plain";

  switch (format) {
    case "text":
      body = p.content;
      break;

    case "markdown": {
      const fence = mdFence(p.content);
      body = [
        `# ${p.title}`,
        p.description ? `\n${p.description}\n` : "",
        p.tags.length ? `**Tags:** ${p.tags.join(", ")}\n` : "",
        `${fence}xml`,
        p.content,
        fence,
      ].filter(Boolean).join("\n");
      mime = "text/markdown";
      break;
    }

    case "json":
      body = JSON.stringify(
        { title: p.title, description: p.description, content: p.content, structured: p.structured, tags: p.tags },
        null, 2
      );
      mime = "application/json";
      break;

    case "yaml":
      body = yaml.dump({
        title: p.title, description: p.description, content: p.content, structured: p.structured, tags: p.tags,
      });
      mime = "text/yaml";
      break;

    case "python":
      body = [
        `"""${pyEscape(p.title)}`,
        ...(p.description ? [`\n${pyEscape(p.description)}`] : []),
        `"""`,
        ``,
        `PROMPT = """${pyEscape(p.content)}"""`,
        ``,
        ``,
        `def build_prompt(user_input: str = "") -> str:`,
        `    """Returns the full prompt, optionally appending user input."""`,
        `    if user_input:`,
        `        return f"{PROMPT}\\n\\nUser Input: {user_input}"`,
        `    return PROMPT`,
        ``,
      ].join("\n");
      mime = "text/x-python";
      break;

    case "typescript":
      body = [
        `/**`,
        ...jsDocLines(p.title),
        ...(p.description ? [" *", ...jsDocLines(p.description)] : []),
        ` */`,
        `export const PROMPT = \`${tsEscape(p.content)}\`;`,
        ``,
        `export function buildPrompt(userInput = ""): string {`,
        `  return userInput ? \`\${PROMPT}\\n\\nUser Input: \${userInput}\` : PROMPT;`,
        `}`,
        ``,
      ].join("\n");
      mime = "text/typescript";
      break;

    default:
      body = p.content;
  }

  return { body, filename: `${name}.${fmt.ext}`, mime };
}

/** Triggers a browser download for the given export. */
export function downloadExport(p: ExportablePrompt, format: ExportFormat): void {
  const { body, filename, mime } = exportPrompt(p, format);
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
