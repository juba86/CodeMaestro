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

function pyEscape(s: string): string {
  // Escape for a Python triple-quoted string.
  return s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}

function tsEscape(s: string): string {
  // Escape for a JS template literal.
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
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

    case "markdown":
      body = [
        `# ${p.title}`,
        p.description ? `\n${p.description}\n` : "",
        p.tags.length ? `**Tags:** ${p.tags.join(", ")}\n` : "",
        "```xml",
        p.content,
        "```",
      ].filter(Boolean).join("\n");
      mime = "text/markdown";
      break;

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
        `"""${p.title}`,
        p.description ? `\n${p.description}` : "",
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
        ` * ${p.title}`,
        p.description ? ` * ${p.description}` : ` *`,
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
