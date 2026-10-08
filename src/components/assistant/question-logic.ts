// Pure answer state of an interactive question card (AskUserQuestion), shared
// by the card and the mobile StickyActionBar. The answer goes back as the deny
// reason in the existing format: „Der Nutzer hat geantwortet:\n- Frage: A, B".
import type { ApprovalEvent } from "./types";

export interface AnswerState {
  /** Chosen option labels per question index. */
  sel: Record<number, string[]>;
  /** Free-text answer per question („Eigene Antwort …"). */
  other: Record<number, string>;
  /** „Eigene Antwort" chosen (single-select questions with options). */
  otherOn: Record<number, boolean>;
}

export const EMPTY_ANSWER: AnswerState = { sel: {}, other: {}, otherOn: {} };

/** Toggle (multi) or pick (single) an option; picking an option turns the own answer off. */
export function chooseOption(s: AnswerState, qi: number, label: string, multi: boolean): AnswerState {
  const cur = s.sel[qi] ?? [];
  if (multi) {
    const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
    return { ...s, sel: { ...s.sel, [qi]: next } };
  }
  return { ...s, sel: { ...s.sel, [qi]: [label] }, otherOn: { ...s.otherOn, [qi]: false } };
}

/** Choose „Eigene Antwort" (single-select: replaces the option). */
export function chooseOther(s: AnswerState, qi: number, multi: boolean, on = true): AnswerState {
  return multi
    ? { ...s, otherOn: { ...s.otherOn, [qi]: on } }
    : { ...s, sel: { ...s.sel, [qi]: [] }, otherOn: { ...s.otherOn, [qi]: on } };
}

export function setOtherText(s: AnswerState, qi: number, text: string): AnswerState {
  return { ...s, other: { ...s.other, [qi]: text.slice(0, 2000) } };
}

/** The answers of question `qi` (options, then the own answer when chosen). */
export function answersOf(card: ApprovalEvent, s: AnswerState, qi: number): string[] {
  const q = card.questions?.[qi];
  const text = (s.other[qi] ?? "").trim();
  // Without options the free text is the only way to answer.
  const ownOn = !q?.options?.length || !!s.otherOn[qi];
  return [...(s.sel[qi] ?? []), ...(ownOn && text ? [text] : [])];
}

/** Number of questions still without an answer. */
export function openQuestions(card: ApprovalEvent, s: AnswerState): number {
  const qs = card.questions ?? [];
  if (qs.length === 0) return 1;
  return qs.filter((_, qi) => answersOf(card, s, qi).length === 0).length;
}

/** „Noch 1 Frage offen" / „Noch 2 Fragen offen" / null when complete. */
export function openQuestionsReason(card: ApprovalEvent, s: AnswerState): string | null {
  const n = openQuestions(card, s);
  if (n === 0) return null;
  if ((card.questions ?? []).length === 0) return "Keine Frage zum Beantworten";
  return n === 1 ? "Noch 1 Frage offen" : `Noch ${n} Fragen offen`;
}

/** The deny reason that carries the answers back to the agent. */
export function answerReason(card: ApprovalEvent, s: AnswerState): string {
  const lines = (card.questions ?? []).map(
    (q, qi) => `- ${q.header || q.question || `Frage ${qi + 1}`}: ${answersOf(card, s, qi).join(", ")}`,
  );
  return `Der Nutzer hat geantwortet:\n${lines.join("\n")}`;
}

export const SKIP_QUESTION_REASON = "Der Nutzer möchte diese Frage nicht beantworten. Entscheide selbst sinnvoll oder frage anders.";
export const PLAN_REJECT_REASON = "Der Nutzer hat den Plan abgelehnt. Bitte überarbeite ihn und frage ggf. nach.";

/** Deny reason for „Überarbeiten …" with the user's hint. */
export function planReviseReason(hint: string): string {
  const h = hint.trim();
  return h ? `Der Nutzer möchte den Plan überarbeitet haben: ${h}` : PLAN_REJECT_REASON;
}

/** Hint presets for „Mit Hinweis ablehnen" (DESIGN.md §6.2.6). */
export const HINT_PRESETS: { label: string; text: string }[] = [
  { label: "Kleinere Schritte", text: "Bitte in kleineren Schritten vorgehen." },
  { label: "Erst fragen", text: "Bitte erst fragen, bevor du so etwas änderst." },
  { label: "Nur Tests ändern", text: "Bitte nur die Tests ändern, nicht den Code." },
];

/** Adds a preset's text to the hint (on its own line, never twice). */
export function addHintPreset(hint: string, text: string): string {
  if (hint.includes(text)) return hint;
  const base = hint.trimEnd();
  return base ? `${base}\n${text}` : text;
}
