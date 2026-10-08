import type { LintIssue, LintSeverity } from "@/lib/prompt-engine/prompt-linter";
import type { PromptStructured } from "@/lib/ai/types";
import { techniqueName } from "./technique-labels";

/**
 * German presentation of the prompt linter (DESIGN.md §8: no raw rule ids).
 * The linter speaks English and keys its findings by `ruleId`; this module
 * maps each rule to a German title and hint, the builder field it concerns,
 * and re-states the dynamic part of the message (counts, quoted snippets) in
 * German where the message carries one.
 */

/** Builder fields an issue can point at. "examples" lives in step 2, "xml" in the preview. */
export type LintField =
  | Exclude<keyof PromptStructured, "technique" | "swarmConfig">
  | "xml";

export interface LintRuleLabel {
  title: string;
  hint: string;
  field?: LintField;
}

export const LINT_RULE_LABEL: Record<string, LintRuleLabel> = {
  "missing-instructions": {
    title: "Ziel fehlt",
    hint: "Jeder Prompt braucht eine klare Hauptanweisung.",
    field: "instructions",
  },
  "short-instructions": {
    title: "Ziel ist sehr knapp",
    hint: "Ergänze, was genau passieren soll, wie, und woran man den Erfolg erkennt.",
    field: "instructions",
  },
  "missing-task": {
    title: "Weder Ziel noch Aufgabe gesetzt",
    hint: "Beschreibe mindestens das Ziel oder die konkrete Aufgabe.",
    field: "instructions",
  },
  "missing-context": {
    title: "Kein Kontext",
    hint: "Hintergrund, Tech-Stack oder Fachgebiet helfen dem Modell, seine Antwort zu verankern.",
    field: "context",
  },
  "missing-constraints": {
    title: "Keine Rahmenbedingungen",
    hint: "Nenne die Grenzen und Nicht-Ziele, auf die es ankommt – jeweils mit Begründung.",
    field: "constraints",
  },
  "missing-output-format": {
    title: "Ausgabeformat fehlt",
    hint: "Lege Form (Markdown, JSON, XML, Abschnitte) und Länge der Antwort fest.",
    field: "outputFormat",
  },
  "missing-audience": {
    title: "Keine Zielgruppe",
    hint: "Eine Zielgruppe stimmt Ton und Tiefe der Antwort ab.",
    field: "targetAudience",
  },
  "missing-examples": {
    title: "Technik braucht Beispiele",
    hint: "Füge 3–5 passende, unterschiedliche Beispiele hinzu (Eingabe, Lösungsweg, Antwort).",
    field: "examples",
  },
  "examples-without-method": {
    title: "Beispiele ohne Lösungsweg",
    hint: "Ergänze zu jedem Beispiel kurz, wie man zur Antwort kommt.",
    field: "examples",
  },
  "examples-count-variety": {
    title: "Anzahl oder Vielfalt der Beispiele prüfen",
    hint:
      "Nimm 3–5 Beispiele, die echten Eingaben ähneln und Randfälle abdecken – unterschiedlich genug, damit das Modell kein ungewolltes Muster kopiert. Starte mit einem und ergänze weitere, wenn die Ausgaben danebenliegen.",
    field: "examples",
  },
  "vague-wording": {
    title: "Vage Formulierungen",
    hint: "Ersetze sie durch messbare, konkrete Anforderungen.",
    field: "instructions",
  },
  "unsupported-request-params": {
    title: "Anfrage, die das Modell ablehnt",
    hint:
      "Entferne die abschließende Assistant-Zeile; „Antworte direkt ohne Vorrede“ gehört in die Anweisungen, ein festes Format in Structured Outputs. Steuere über den Prompt und die Effort-Einstellung, nicht über temperature.",
    field: "task",
  },
  "reasoning-extraction-risk": {
    title: "Verlangt sichtbares Nachdenken",
    hint:
      "Bitte stattdessen um „eine kurze Erklärung“, „die Belege für das Ergebnis“ oder „eine Zusammenfassung der Schritte“. Benenne ein Schemafeld in brief_explanation oder evidence um und <thinking> in Beispielen in <method>.",
    field: "instructions",
  },
  "obsolete-think-step-by-step": {
    title: "Veraltete Denk-Floskel",
    hint:
      "Bei Modellen mit adaptivem Denken bringt „Denke Schritt für Schritt“ nichts mehr. Lösche die Zeile und stelle die Effort-Stufe ein (low bis max). In Claude Code erhöht nur „ultrathink“ das Denken für eine Runde.",
    field: "instructions",
  },
  "emphasis-overload": {
    title: "Zu viel Nachdruck",
    hint:
      "Neuere Claude-Modelle reagieren auf aggressive Formulierungen über, und wenn vieles betont ist, sticht nichts heraus. Schreib in normalem Ton und nenne den Grund; „IMPORTANT“ höchstens in der einen Zeile, die sonst übergangen wird.",
    field: "constraints",
  },
  "negative-only-instruction": {
    title: "Nur Verbote, keine Alternative",
    hint:
      "Sag, was stattdessen passieren soll, z. B. „Schreibe in fließenden Absätzen“ statt „Kein Markdown“. Positive Beispiele wirken besser als Verbotslisten.",
    field: "constraints",
  },
  "rule-without-reason": {
    title: "Regeln ohne Begründung",
    hint: "Hänge den Grund an. Claude überträgt die Begründung auf Fälle, die die Regel nicht ausdrücklich nennt.",
    field: "constraints",
  },
  "missing-definition-of-done": {
    title: "Keine Definition of Done",
    hint:
      "Nenne einen messbaren Endzustand mit Prüfung und den wichtigen Rahmenbedingungen, z. B. „Fertig heißt: Alle Endpunkte nutzen den neuen Client, der alte ist gelöscht, und die Tests laufen grün.“",
    field: "task",
  },
  "agentic-missing-verification": {
    title: "Keine ausführbare Prüfung",
    hint:
      "Gib dem Agenten einen Check, den er selbst ausführen kann – Testbefehl, Typecheck, Build oder Screenshot-Vergleich – und verlange Befehl und Ausgabe als Beleg.",
    field: "constraints",
  },
  "unbounded-loop": {
    title: "Loop ohne Grenze",
    hint:
      "Ergänze „oder nach N Durchläufen stoppen“ bzw. ein Iterations- oder Budgetlimit, einen Check, den das Protokoll belegt (z. B. „`npm test` endet mit 0“), und ein exaktes Abschlusssignal, das nur bei erfüllter Bedingung ausgegeben wird. Setze das Limit auch im Harness.",
    field: "constraints",
  },
  "long-input-after-query": {
    title: "Langer Kontext nach der Frage",
    hint:
      "Lange Dokumente gehören an den Anfang (in <documents>), Anweisung und Frage ans Ende. Bei komplexen Eingaben aus mehreren Dokumenten verbessert das die Antworten laut Anthropic um bis zu 30 %.",
    field: "context",
  },
  "no-length-guidance": {
    title: "Keine Längenvorgabe",
    hint: "Sag, wie lang die Antwort sein soll oder womit sie beginnt, z. B. „Beginne mit dem Ergebnis in einem Satz, dann die Details.“",
    field: "outputFormat",
  },
  "xml-unbalanced": {
    title: "XML-Tags unvollständig",
    hint: "Jedes Abschnitts-Tag braucht ein schließendes Tag. Tags im Text eines Abschnitts (etwa <promise>) zählen hier nicht.",
    field: "xml",
  },
  "large-prompt": {
    title: "Sehr langer Prompt",
    hint: "Kürze Wiederholungen – lange Prompts kosten mehr und verwässern den Fokus.",
    field: "xml",
  },
};

/** DOM id of the control that edits `field` (shared by the form, the section editor and the preview). */
export function fieldDomId(field: LintField): string {
  return `pb-field-${field}`;
}

export const SEVERITY_LABEL: Record<LintSeverity, string> = {
  error: "Fehler",
  warning: "Warnung",
  info: "Hinweis",
};

/** Field names as the builder labels them, for "Zum Feld: …" links. */
export const FIELD_LABEL: Record<LintField, string> = {
  instructions: "Ziel / Anweisungen",
  context: "Kontext",
  constraints: "Rahmenbedingungen",
  targetAudience: "Zielgruppe",
  outputFormat: "Ausgabeformat",
  task: "Aufgabe",
  examples: "Beispiele",
  xml: "XML",
};

export interface DescribedIssue {
  title: string;
  /** German restatement of the message's specifics (counts, snippets). */
  detail?: string;
  hint?: string;
  field?: LintField;
  /** Set when no German label exists: the raw English message, shown with lang="en". */
  untranslated?: string;
}

const quotes = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const quoted = (s: string) => `„${s}“`;

/** "1,234" / "1.234" / "1234" → "1.234" (German grouping). */
function tokensIn(message: string): string | null {
  const m = message.match(/~([\d.,\s]+)\s*tokens/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("de-DE") : null;
}

const EXAMPLE_PROBLEMS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(\d+) examples \(more than 5\)$/, (m) => `${m[1]} Beispiele (mehr als 5)`],
  [/^only (\d+) examples?$/, (m) => (m[1] === "1" ? "nur 1 Beispiel" : `nur ${m[1]} Beispiele`)],
  [/^examples (\d+) and (\d+) have nearly identical inputs$/, (m) => `Beispiele ${m[1]} und ${m[2]} haben fast gleiche Eingaben`],
  [/^all answers start with the same five words$/, () => "alle Antworten beginnen mit denselben fünf Wörtern"],
];

const REQUEST_PROBLEMS: [RegExp, string][] = [
  [/ends with an assistant turn \(prefill\)/, "endet mit einer Assistant-Zeile (Prefill)"],
  [/sets temperature\/top_p\/top_k/, "setzt temperature, top_p oder top_k"],
  [/uses thinking\.budget_tokens/, "nutzt thinking.budget_tokens"],
];

function detailFor(issue: LintIssue): string | undefined {
  const msg = issue.message;
  switch (issue.ruleId) {
    case "vague-wording": {
      const words = msg.match(/:\s*(.+?)\.?$/)?.[1];
      return words ? `Gefunden: ${words}` : undefined;
    }
    case "emphasis-overload": {
      const count = msg.match(/: (\d+) shouted/)?.[1];
      const words = msg.match(/shouted words or lines \(([^)]*)\)/)?.[1];
      const trigger = quotes(msg)[0];
      const parts = [
        count ? `${count} betonte Wörter oder Zeilen${words ? ` (${words})` : ""}` : "",
        trigger ? quoted(trigger) : "",
      ].filter(Boolean);
      return parts.length ? `Gefunden: ${parts.join(" und ")}` : undefined;
    }
    case "negative-only-instruction": {
      const n = msg.match(/^(\d+)/)?.[1];
      const q = quotes(msg)[0];
      if (!n) return undefined;
      const lead = n === "1" ? "1 Anweisung sagt nur, was nicht passieren soll" : `${n} Anweisungen sagen nur, was nicht passieren soll`;
      return q ? `${lead}, z. B. ${quoted(q)}` : lead;
    }
    case "rule-without-reason": {
      const n = msg.match(/^(\d+)/)?.[1];
      const qs = quotes(msg);
      if (!n) return undefined;
      return `${n} feste Regeln ohne Begründung${qs.length ? `: ${qs.map(quoted).join(", ")}` : ""}`;
    }
    case "reasoning-extraction-risk":
    case "obsolete-think-step-by-step": {
      const q = quotes(msg)[0];
      return q ? `Fundstelle: ${quoted(q)}` : undefined;
    }
    case "examples-count-variety": {
      const list = msg.match(/too similar: (.+?)\.?$/)?.[1];
      if (!list) return undefined;
      const parts = list.split("; ").map((p) => {
        for (const [re, de] of EXAMPLE_PROBLEMS) {
          const m = p.match(re);
          if (m) return de(m);
        }
        return null;
      });
      return parts.every(Boolean) ? `Auffällig: ${parts.join("; ")}` : undefined;
    }
    case "unsupported-request-params": {
      const found = REQUEST_PROBLEMS.filter(([re]) => re.test(msg)).map(([, de]) => de);
      if (found.length === 0) return undefined;
      const model = msg.match(/, which (.+) rejects with HTTP 400/)?.[1];
      const rejected = /which Claude 4\.6\+ rejects/.test(msg) ? " – Claude 4.6+ lehnt das ab" : "";
      return `Der Prompt ${found.join(" und ")}${rejected}${model ? ` – ${model} lehnt das mit HTTP 400 ab` : ""}.`;
    }
    case "missing-examples": {
      const id = quotes(msg)[0];
      return id ? `Die Technik ${quoted(techniqueName(id))} wirkt am besten mit Beispielen.` : undefined;
    }
    case "long-input-after-query": {
      const t = tokensIn(msg);
      return t ? `Rund ${t} Tokens Kontext stehen nach den Anweisungen oder der Frage.` : undefined;
    }
    case "large-prompt": {
      const t = tokensIn(msg);
      return t ? `Rund ${t} Tokens.` : undefined;
    }
    case "xml-unbalanced": {
      const tags = msg.match(/unbalanced: (.+?)\.?$/)?.[1];
      return tags ? `Betroffen: ${tags}` : undefined;
    }
    default:
      return undefined;
  }
}

function loopTitle(message: string): string {
  if (/iteration bound/.test(message)) return "Loop ohne Iterationsgrenze";
  if (/verifiable check/.test(message)) return "Loop ohne prüfbaren Check";
  if (/completion marker/.test(message)) return "Loop ohne Abschlusssignal";
  return LINT_RULE_LABEL["unbounded-loop"].title;
}

/** German title, detail, hint and target field for one linter finding. */
export function describeIssue(issue: LintIssue): DescribedIssue {
  const label = LINT_RULE_LABEL[issue.ruleId];
  if (!label) {
    // A rule added to the linter without a German label: never show its id;
    // fall back to the (English) message, marked as such for screen readers.
    return { title: "Hinweis zum Prompt", untranslated: [issue.message, issue.hint].filter(Boolean).join(" ") };
  }
  return {
    title: issue.ruleId === "unbounded-loop" ? loopTitle(issue.message) : label.title,
    detail: detailFor(issue),
    hint: label.hint,
    field: label.field,
  };
}
