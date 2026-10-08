"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, Library, MessageSquarePlus, TriangleAlert } from "lucide-react";
import type { OrchestraLiveState } from "@/components/orchestra";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-media-query";
import { isEditableTarget } from "@/lib/hotkeys";
import { ApprovalCard, GateReceiptRow } from "./approval-card";
import { gateDomId, revealGate } from "./gate-context";
import { PlanApprovalCard } from "./plan-card";
import { QuestionCard } from "./question-card";
import { gateAnnouncement } from "./risk-flags";
import type { GateReceipt, PendingCard, RunEnd } from "./run-events";
import { PendingTray } from "./sticky-action-bar";
import { SubtaskSection } from "./subtask-section";
import {
  AgentLine,
  AssistantMessage,
  ErrorNote,
  IterationDivider,
  KnowledgeNote,
  LoopEndNote,
  LoopWaitNote,
  PlanBlock,
  RunEndNote,
  SynthesisBlock,
  SystemNote,
  ThinkingRow,
  UserPrompt,
} from "./thread-blocks";
import { iterationOf, type ThreadBlock } from "./thread-model";
import { ToolGroup } from "./tool-group";

const STICK_PX = 80;

export const SUGGESTIONS = ["Projekt erklären", "Tests ausführen und Fehler beheben", "README verbessern"];

export interface ThreadProps {
  blocks: ThreadBlock[];
  pending: PendingCard[];
  receipts: GateReceipt[];
  orch: OrchestraLiveState;
  provider?: string;
  model?: string;
  loading: boolean;
  running: boolean;
  telegram: boolean;
  ended: RunEnd | null;
  /** Status line while nothing streams yet („Plan wird erstellt …"). */
  status?: string | null;
  /** Re-sends the last prompt (error notes). */
  onRetry?: () => void;
  /** Fills the composer (empty-thread suggestions). */
  onSuggest: (text: string) => void;
  /** Extra content after the thread (the hybrid plan editor). */
  footer?: React.ReactNode;
  now: number;
  /** Changes whenever the session changes (resets scroll state). */
  sessionKey: string | null;
}

function scrollToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight;
}

export function Thread({
  blocks,
  pending,
  receipts,
  orch,
  provider,
  model,
  loading,
  running,
  telegram,
  ended,
  status,
  onRetry,
  onSuggest,
  footer,
  now,
  sessionKey,
}: ThreadProps) {
  const isMobile = useIsMobile();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const stick = React.useRef(true);
  const [pill, setPill] = React.useState<null | "activity" | "gate">(null);
  const [announce, setAnnounce] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<number>>(() => new Set());
  const [hiddenPending, setHiddenPending] = React.useState<string[]>([]);
  const knownGates = React.useRef<Set<string> | null>(null);

  // New session: start at the bottom, forget collapsed iterations and gates.
  React.useEffect(() => {
    stick.current = true;
    knownGates.current = null;
    setPill(null);
    setCollapsed(new Set());
  }, [sessionKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stick.current && pill) setPill(null);
  };

  const hasFooter = !!footer;
  // Follow new output only while the reader is at the bottom (§6.2.4).
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;
    if (stick.current) scrollToBottom(el);
    else setPill((p) => p ?? "activity");
  }, [blocks, pending.length, receipts.length, hasFooter, loading, status]);

  // A new gate: assertive announcement; focus moves to it unless the user types.
  const pendingIds = pending.map((p) => p.approvalId).join("|");
  React.useEffect(() => {
    if (loading) return;
    const ids = pendingIds ? pendingIds.split("|") : [];
    const first = knownGates.current === null;
    const known = knownGates.current ?? new Set<string>();
    const fresh = ids.filter((id) => !known.has(id));
    knownGates.current = new Set(ids);
    if (!fresh.length) return;
    const card = pending.find((p) => p.approvalId === fresh[0]);
    if (card) setAnnounce(gateAnnouncement(card));
    if (first) return; // opening a session with open gates does not steal focus
    if (!stick.current) setPill("gate");
    const active = document.activeElement as HTMLElement | null;
    const typing = active && isEditableTarget(active);
    if (!typing && !isMobile) requestAnimationFrame(() => revealGate(fresh[0]));
  }, [pendingIds, pending, loading, isMobile]);

  // Which pending cards are out of view (desktop PendingTray).
  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root || isMobile || !pending.length || typeof IntersectionObserver === "undefined") {
      setHiddenPending([]);
      return;
    }
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.gate;
          if (id) visible.set(id, e.isIntersecting);
        }
        setHiddenPending(pending.filter((p) => visible.get(p.approvalId) === false).map((p) => p.approvalId));
      },
      { root, threshold: 0.15 },
    );
    for (const p of pending) {
      const el = document.getElementById(gateDomId(p.approvalId));
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [pendingIds, pending, isMobile, blocks]);

  const iters = React.useMemo(() => iterationOf(blocks), [blocks]);
  const lastIter = iters.length ? Math.max(...iters) : 0;
  const pendingById = React.useMemo(() => new Map(pending.map((p) => [p.approvalId, p])), [pending]);
  const receiptById = React.useMemo(() => new Map(receipts.map((r) => [r.approvalId, r])), [receipts]);
  const liveSubtasks = React.useMemo(() => new Map(orch.subtasks.map((s) => [s.id, s])), [orch.subtasks]);

  const toggleIteration = (n: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const renderBlock = (b: ThreadBlock, i: number): React.ReactNode => {
    switch (b.kind) {
      case "user":
        return <UserPrompt text={b.text} loop={b.loop} local={b.local} />;
      case "assistant":
        return (
          <div>
            {b.segmentStart ? <AgentLine provider={provider} model={model} /> : null}
            <AssistantMessage text={b.text} />
          </div>
        );
      case "thinking":
        return (
          <div>
            {b.segmentStart ? <AgentLine provider={provider} model={model} /> : null}
            <ThinkingRow text={b.text} />
          </div>
        );
      case "tools":
        return (
          <div>
            {b.segmentStart ? <AgentLine provider={provider} model={model} /> : null}
            <ToolGroup group={b.group} />
          </div>
        );
      case "knowledge":
        return <KnowledgeNote sources={b.sources} />;
      case "iteration": {
        const key = iters[i];
        const past = key !== 0 && key !== lastIter;
        return (
          <IterationDivider
            iteration={b.iteration}
            max={b.max}
            fresh={b.fresh}
            at={b.at}
            collapsed={collapsed.has(key)}
            onToggle={past ? () => toggleIteration(key) : undefined}
          />
        );
      }
      case "loop_wait":
        return <LoopWaitNote resumeAt={b.resumeAt} text={b.text} />;
      case "loop_end":
        return <LoopEndNote reason={b.reason} iterations={b.iterations} />;
      case "system":
        return <SystemNote text={b.text} />;
      case "error":
        // The thread ends in an error: offer „Erneut ausführen" (re-sends the last prompt).
        return <ErrorNote text={b.text} onRetry={!running && i === blocks.length - 1 ? onRetry : undefined} />;
      case "plan":
        return <PlanBlock subtasks={b.subtasks} roles={b.roles} workers={b.workers} />;
      case "subtask":
        return (
          <SubtaskSection
            section={b.section}
            liveSubtask={b.section.live ? liveSubtasks.get(b.section.subtaskId) : undefined}
            now={now}
          />
        );
      case "synthesis":
        return <SynthesisBlock text={b.text} />;
      case "gate": {
        const card = pendingById.get(b.approvalId);
        if (card) {
          if (card.type === "question_request") {
            return card.kind === "plan" ? <PlanApprovalCard card={card} /> : <QuestionCard card={card} />;
          }
          return <ApprovalCard card={card} />;
        }
        const receipt = receiptById.get(b.approvalId);
        return receipt ? <GateReceiptRow receipt={receipt} telegram={telegram} /> : null;
      }
    }
  };

  const empty = !loading && blocks.length === 0 && !running && !status && !footer;
  const trayCard = !isMobile ? pending.find((p) => hiddenPending.includes(p.approvalId)) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        role="log"
        aria-live="off"
        aria-label="Verlauf"
        tabIndex={-1}
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-4 py-4 md:px-6">
          {loading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Verlauf wird geladen">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-24 w-11/12 rounded-lg" />
              <Skeleton className="h-10 w-2/3 rounded-lg" />
            </div>
          ) : null}
          {empty ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span aria-hidden className="grid size-10 place-items-center rounded-lg border border-border bg-surface-2 text-subtle-foreground">
                <MessageSquarePlus className="size-5" />
              </span>
              <p className="text-sm font-medium">Womit soll der Agent anfangen?</p>
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => onSuggest(s)}>
                    {s}
                  </Button>
                ))}
                <Button variant="outline" size="sm" asChild>
                  <Link href="/library">
                    <Library aria-hidden />
                    Aus Bibliothek einfügen …
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
          {blocks.map((b, i) => {
            const key = iters[i];
            if (key !== 0 && collapsed.has(key) && b.kind !== "iteration") return null;
            return (
              <div key={b.key} data-block-key={b.key} className="min-w-0">
                {renderBlock(b, i)}
              </div>
            );
          })}
          {!running && ended && !(ended.status === "error" && blocks[blocks.length - 1]?.kind === "error") ? (
            <RunEndNote ended={ended} onRetry={ended.status === "error" ? onRetry : undefined} />
          ) : null}
          {status ? (
            <p className="flex items-center gap-2 text-ui text-muted-foreground" role="status">
              <span aria-hidden className="size-2 rounded-full bg-primary motion-safe:animate-breathe" />
              {status}
            </p>
          ) : null}
          {footer}
        </div>
        {trayCard || pill ? (
          <div className="pointer-events-none sticky bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-2">
            {pill ? (
              <Button
                size="sm"
                variant={pill === "gate" ? "outline" : "secondary"}
                className={
                  pill === "gate"
                    ? "pointer-events-auto border-warning-border bg-card text-warning shadow-md"
                    : "pointer-events-auto shadow-md"
                }
                onClick={() => {
                  const el = scrollRef.current;
                  if (el) scrollToBottom(el);
                  stick.current = true;
                  setPill(null);
                }}
              >
                {pill === "gate" ? <TriangleAlert aria-hidden /> : null}
                {pill === "gate" ? "Freigabe nötig" : "Neue Aktivität"}
                <ArrowDown aria-hidden />
              </Button>
            ) : null}
            {trayCard ? (
              <div className="pointer-events-auto w-full">
                <PendingTray card={trayCard} count={hiddenPending.length} onShow={() => revealGate(trayCard.approvalId)} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {announce}
      </div>
    </div>
  );
}
