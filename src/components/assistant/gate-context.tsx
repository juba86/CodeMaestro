"use client";

// Shared state of the open gates (approval, question and plan cards) of the
// active session: question answers and hint drafts live here so the inline
// card and the mobile StickyActionBar act on the same values.
import * as React from "react";
import { EMPTY_ANSWER, type AnswerState } from "./question-logic";
import type { ApprovalEvent, Decide } from "./types";

export interface GateContextValue {
  decide: Decide;
  cwd?: string;
  /** The session runs in Claude Code's sandbox. */
  sandbox?: boolean;
  /** GitHub connection for push approvals (null = unknown / not loaded). */
  githubConnected: boolean | null;
  answerOf: (approvalId: string) => AnswerState;
  setAnswer: (approvalId: string, update: (s: AnswerState) => AnswerState) => void;
  /** Opens the hint sheet (mobile) for a deny with hint or a plan revision. */
  openHint: (card: ApprovalEvent) => void;
}

const GateContext = React.createContext<GateContextValue | null>(null);

export function useGates(): GateContextValue {
  const ctx = React.useContext(GateContext);
  if (!ctx) throw new Error("useGates outside GateProvider");
  return ctx;
}

/** Loads GET /api/github once while `enabled` (push approvals only). */
function useGithubConnected(enabled: boolean): boolean | null {
  const [connected, setConnected] = React.useState<boolean | null>(null);
  const needed = enabled && connected === null;
  React.useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    fetch("/api/github", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: { connected?: boolean } } | null) => {
        if (!cancelled && d?.status && typeof d.status.connected === "boolean") setConnected(d.status.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needed]);
  return connected;
}

export function GateProvider({
  decide,
  cwd,
  sandbox,
  needGithub,
  openHint,
  children,
}: {
  decide: Decide;
  cwd?: string;
  sandbox?: boolean;
  /** A push approval is open: check the GitHub connection. */
  needGithub: boolean;
  openHint: (card: ApprovalEvent) => void;
  children: React.ReactNode;
}) {
  const [answers, setAnswers] = React.useState<Record<string, AnswerState>>({});
  const githubConnected = useGithubConnected(needGithub);
  const answerOf = React.useCallback((id: string) => answers[id] ?? EMPTY_ANSWER, [answers]);
  const setAnswer = React.useCallback((id: string, update: (s: AnswerState) => AnswerState) => {
    setAnswers((prev) => ({ ...prev, [id]: update(prev[id] ?? EMPTY_ANSWER) }));
  }, []);
  // Deciding removes the card (or the sticky bar) that had focus; keep the
  // keyboard/screen-reader position on the receipt that takes its place.
  const decideKeepingFocus = React.useCallback<Decide>(
    (card, decision, reason) => {
      decide(card, decision, reason);
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        document.getElementById(gateDomId(card.approvalId))?.focus({ preventScroll: true });
      });
    },
    [decide],
  );
  const value = React.useMemo<GateContextValue>(
    () => ({ decide: decideKeepingFocus, cwd, sandbox, githubConnected, answerOf, setAnswer, openHint }),
    [decideKeepingFocus, cwd, sandbox, githubConnected, answerOf, setAnswer, openHint],
  );
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

/** DOM id of a gate card (scroll targets, focus). */
export const gateDomId = (approvalId: string) => `gate-${approvalId.replace(/[^\w-]/g, "_")}`;

/** Scrolls a gate card into view and focuses its heading. */
export function revealGate(approvalId: string, focus = true) {
  const el = document.getElementById(gateDomId(approvalId));
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  if (focus) (el.querySelector<HTMLElement>("[data-gate-heading]") ?? el).focus({ preventScroll: true });
}
