"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, ListChecks, MessageCircleQuestion, MessageSquareText, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useBottomChrome } from "@/components/ui/toaster";
import { HintEditor } from "./approval-card";
import { revealGate, useGates } from "./gate-context";
import { SKIP_QUESTION_REASON, answerReason, openQuestionsReason, planReviseReason } from "./question-logic";
import { gateTarget } from "./risk-flags";
import type { PendingCard } from "./run-events";
import type { ApprovalEvent } from "./types";

function KindIcon({ card }: { card: ApprovalEvent }) {
  if (card.type === "question_request") {
    return card.kind === "plan" ? (
      <ListChecks aria-hidden className="size-5 shrink-0 text-warning" />
    ) : (
      <MessageCircleQuestion aria-hidden className="size-5 shrink-0 text-info" />
    );
  }
  return <ShieldAlert aria-hidden className="size-5 shrink-0 text-warning" />;
}

/**
 * Mobile thumb-zone bar for the open gates (DESIGN.md §6.2.7, B graft). It
 * replaces the composer while the session has pending items.
 */
export function StickyActionBar({ cards }: { cards: PendingCard[] }) {
  const { decide, answerOf, openHint } = useGates();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = React.useState(0);
  useBottomChrome(ref, cards.length > 0);
  const i = Math.min(index, Math.max(0, cards.length - 1));
  const card = cards[i];
  if (!card) return null;

  const isQuestion = card.type === "question_request" && card.kind !== "plan";
  const isPlan = card.type === "question_request" && card.kind === "plan";
  const blocked = isQuestion ? openQuestionsReason(card, answerOf(card.approvalId)) : null;

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Offene Freigaben"
      className="z-10 shrink-0 border-t border-border-strong bg-popover px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] shadow-lg"
    >
      <div className="flex min-h-10 items-center gap-2">
        <button
          type="button"
          onClick={() => revealGate(card.approvalId)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`${gateTarget(card)} – zur Karte springen`}
        >
          <KindIcon card={card} />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{gateTarget(card)}</span>
        </button>
        {cards.length > 1 ? (
          <div className="flex shrink-0 items-center">
            <IconButton aria-label="Vorherige Freigabe" size="icon" disabled={i === 0} onClick={() => setIndex(i - 1)}>
              <ChevronLeft />
            </IconButton>
            <span className="text-xs tabular-nums text-muted-foreground">
              {i + 1} von {cards.length}
            </span>
            <IconButton aria-label="Nächste Freigabe" size="icon" disabled={i === cards.length - 1} onClick={() => setIndex(i + 1)}>
              <ChevronRight />
            </IconButton>
          </div>
        ) : null}
        {/* Visual copy only: the card's own countdown announces (60s / 15s once, not twice). */}
        {card.expiresAt ? (
          <span aria-hidden className="shrink-0">
            <Countdown expiresAt={card.expiresAt} label="" className="text-sm" />
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex gap-2">
        {isQuestion ? (
          <>
            {/* The card's footer (with „Überspringen") is hidden on the phone. */}
            <Button variant="outline" size="xl" className="flex-1 px-2" onClick={() => decide(card, "deny", SKIP_QUESTION_REASON)}>
              Überspringen
            </Button>
            <Button
              variant="primary"
              size="xl"
              className="flex-[1.4] px-2"
              disabledReason={blocked ?? undefined}
              onClick={() => decide(card, "deny", answerReason(card, answerOf(card.approvalId)))}
            >
              <Check aria-hidden />
              Antworten
            </Button>
          </>
        ) : isPlan ? (
          <>
            <Button variant="outline" size="xl" className="flex-1" onClick={() => openHint(card)}>
              Überarbeiten
            </Button>
            <Button variant="primary" size="xl" className="flex-[1.4]" onClick={() => decide(card, "allow")}>
              <Check aria-hidden />
              Plan freigeben
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger-outline" size="xl" className="flex-1 px-2" onClick={() => decide(card, "deny")}>
              Ablehnen
            </Button>
            <Button variant="outline" size="xl" className="flex-1 px-2" onClick={() => openHint(card)}>
              <MessageSquareText aria-hidden />
              Hinweis
            </Button>
            <Button variant="primary" size="xl" className="flex-[1.4] px-2" onClick={() => decide(card, "allow")}>
              <Check aria-hidden />
              Freigeben
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Bottom sheet for „Mit Hinweis ablehnen" / plan revision on the phone. */
export function HintSheet({ card, onClose }: { card: ApprovalEvent | null; onClose: () => void }) {
  const { decide } = useGates();
  const [hint, setHint] = React.useState("");
  const isPlan = card?.type === "question_request" && card.kind === "plan";
  return (
    <Sheet
      open={!!card}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setHint("");
        }
      }}
    >
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{isPlan ? "Plan überarbeiten lassen" : "Mit Hinweis ablehnen"}</SheetTitle>
          {card ? <SheetDescription>{gateTarget(card)}</SheetDescription> : null}
        </SheetHeader>
        <SheetBody>
          {card ? (
            <HintEditor
              label={isPlan ? "Was soll am Plan anders werden?" : "Was soll der Agent anders machen?"}
              submitLabel={isPlan ? "Überarbeiten lassen" : "Ablehnen & Hinweis senden"}
              value={hint}
              onChange={setHint}
              onSubmit={() => {
                decide(card, "deny", isPlan ? planReviseReason(hint) : hint.trim() || undefined);
                setHint("");
                onClose();
              }}
            />
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** Desktop: strip above the composer while a pending card is out of view. */
export function PendingTray({ card, count, onShow }: { card: PendingCard; count: number; onShow: () => void }) {
  return (
    // Not a live region: it appears and hides as the reader scrolls; the gate was announced on arrival.
    <div
      className="mx-auto mb-2 flex w-full max-w-[760px] min-w-0 items-center gap-2 rounded-lg border border-warning-border bg-card bg-linear-to-r from-warning-subtle to-warning-subtle px-3 py-1.5 text-ui shadow-sm"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{card.type === "question_request" ? (card.kind === "plan" ? "Plan" : "Frage") : "Freigabe"}:</span>{" "}
        {gateTarget(card)}
        {count > 1 ? <span className="text-muted-foreground"> · {count - 1} weitere</span> : null}
      </span>
      {card.expiresAt ? (
        <span aria-hidden className="hidden shrink-0 sm:inline-flex">
          <Countdown expiresAt={card.expiresAt} />
        </span>
      ) : null}
      <Button size="sm" variant="outline" onClick={onShow}>
        Ansehen
      </Button>
    </div>
  );
}
