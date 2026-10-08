"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CircleSlash, Maximize2, MessageSquareText, ShieldAlert, TimerOff, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { CommandBlock } from "@/components/ui/code-block";
import { Countdown } from "@/components/ui/countdown";
import { DiffView } from "@/components/ui/diff-view";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useIsMobile } from "@/hooks/use-media-query";
import { isEditableTarget } from "@/lib/hotkeys";
import { formatClock } from "@/lib/format";
import { toolLabel } from "@/lib/labels";
import { gateDomId, useGates } from "./gate-context";
import { HINT_PRESETS, addHintPreset } from "./question-logic";
import {
  RISK_FLAG_LABEL,
  approvalKind,
  approvalTitle,
  bashRiskFlags,
  gateTarget,
  overwriteLineCount,
} from "./risk-flags";
import type { GateReceipt, PendingCard } from "./run-events";
import { relativePath } from "./tool-calls";
import type { ApprovalEvent } from "./types";

/** Hint textarea with preset chips (deny with hint, plan revision). */
export function HintEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel = "Ablehnen & Hinweis senden",
  label = "Was soll der Agent anders machen?",
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  label?: string;
  autoFocus?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-ui font-medium text-foreground">
        {label}
      </label>
      <Textarea
        id={id}
        autoFocus={autoFocus}
        autosize={{ min: 2, max: 6 }}
        value={value}
        maxLength={4000}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vorschläge">
        {HINT_PRESETS.map((p) => (
          <ToggleChip
            key={p.label}
            pressed={value.includes(p.text)}
            onPressedChange={(on) => onChange(on ? addHintPreset(value, p.text) : value.replace(p.text, "").replace(/\n{2,}/g, "\n").trim())}
          >
            {p.label}
          </ToggleChip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="danger-outline" onClick={onSubmit}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FullDiffSheet({ card, open, onOpenChange }: { card: ApprovalEvent; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92dvh]">
        <SheetHeader>
          <SheetTitle className="truncate font-mono text-sm">{card.filePath}</SheetTitle>
          <SheetDescription>{approvalTitle(card)}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <DiffView parts={card.diff ?? []} wrap showWrapToggle={false} aria-label={`Änderungen an ${card.filePath ?? "der Datei"}`} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** The approval card (DESIGN.md §6.2.6). A / D / H act while it has focus. */
export function ApprovalCard({ card }: { card: PendingCard }) {
  const { decide, cwd, sandbox, githubConnected, openHint } = useGates();
  const isMobile = useIsMobile();
  const titleId = React.useId();
  const [hintOpen, setHintOpen] = React.useState(false);
  const [hint, setHint] = React.useState("");
  const [fullOpen, setFullOpen] = React.useState(false);
  const kind = approvalKind(card);
  const path = card.filePath ? relativePath(card.filePath, cwd) : "";
  const diff = card.diff ?? [];

  const allow = () => decide(card, "allow");
  const deny = () => decide(card, "deny");
  const startHint = () => (isMobile ? openHint(card) : setHintOpen(true));
  const sendHint = () => decide(card, "deny", hint.trim() || undefined);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    if (isEditableTarget(e.target as HTMLElement)) return;
    const k = e.key.toLowerCase();
    // preventDefault: the global „g a"/„g h" sequences must skip these keys.
    if (k === "a") {
      e.preventDefault();
      allow();
    } else if (k === "d") {
      e.preventDefault();
      deny();
    } else if (k === "h") {
      e.preventDefault();
      startHint();
    }
  };

  const flags = kind === "bash" || kind === "push" ? bashRiskFlags(card.command, cwd) : [];

  return (
    <Card
      id={gateDomId(card.approvalId)}
      variant="warning"
      role="region"
      aria-labelledby={titleId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="scroll-mt-4 overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      data-gate={card.approvalId}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning-border bg-warning-subtle px-3 py-2">
        <ShieldAlert aria-hidden className="size-4 shrink-0 text-warning" />
        <h2 id={titleId} tabIndex={-1} data-gate-heading className="text-ui font-semibold text-foreground outline-none">
          {approvalTitle(card)}
        </h2>
        {card.tool ? <Badge variant="neutral">{toolLabel(card.tool)}</Badge> : null}
        {card.expiresAt ? <Countdown expiresAt={card.expiresAt} variant="ring" className="ml-auto" /> : null}
      </div>

      <div className="space-y-3 p-3">
        {kind === "bash" || kind === "push" ? (
          <>
            <CommandBlock command={card.command ?? ""} cwd={cwd} sandbox={sandbox} />
            {flags.length ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Risiken">
                {flags.map((f) => (
                  <Badge key={f} variant="danger">
                    {RISK_FLAG_LABEL[f]}
                  </Badge>
                ))}
              </div>
            ) : null}
            {kind === "push" && githubConnected === false ? (
              <Callout
                variant="warning"
                title="GitHub ist nicht verbunden – der Push wird fehlschlagen."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/settings?section=github">Jetzt verbinden</Link>
                  </Button>
                }
              />
            ) : null}
          </>
        ) : diff.length ? (
          <>
            {kind === "write_overwrite" ? (
              <Callout variant="warning">
                <strong className="font-semibold">Überschreibt eine bestehende Datei</strong> ({overwriteLineCount(diff)}{" "}
                {overwriteLineCount(diff) === 1 ? "Zeile" : "Zeilen"}). Inhalt, der hier fehlt, geht verloren.
              </Callout>
            ) : null}
            <DiffView
              parts={diff}
              maxLines={isMobile ? 80 : 300}
              aria-label={`Änderungen an ${path || "der Datei"}`}
              title={
                <>
                  <span className="min-w-0 break-all font-mono text-xs text-foreground">{path}</span>
                  {kind === "write_new" ? <Badge variant="success">neue Datei</Badge> : null}
                  {kind === "write_overwrite" ? <Badge variant="warning">ersetzt bestehende Datei</Badge> : null}
                </>
              }
            />
            {isMobile ? (
              <Button variant="ghost" size="sm" onClick={() => setFullOpen(true)}>
                <Maximize2 aria-hidden />
                Vollbild
              </Button>
            ) : null}
            <FullDiffSheet card={card} open={fullOpen} onOpenChange={setFullOpen} />
          </>
        ) : (
          <p className="break-all font-mono text-xs text-muted-foreground">{path || card.command || card.tool}</p>
        )}

        {hintOpen ? (
          <HintEditor value={hint} onChange={setHint} onSubmit={sendHint} onCancel={() => setHintOpen(false)} />
        ) : null}
      </div>

      {/* Mobile: the StickyActionBar carries the actions. */}
      <div className="hidden flex-wrap items-center gap-2 border-t border-border px-3 py-2.5 md:flex">
        <Button variant="primary" kbd="A" onClick={allow}>
          <Check aria-hidden />
          Freigeben
        </Button>
        <Button variant="outline" kbd="D" onClick={deny}>
          Ablehnen
        </Button>
        {!hintOpen ? (
          <Button variant="ghost" kbd="H" onClick={startHint}>
            <MessageSquareText aria-hidden />
            Mit Hinweis ablehnen
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-subtle-foreground">Ohne Entscheidung wird nach Ablauf abgelehnt.</span>
      </div>
    </Card>
  );
}

/** One-line record of a decided or expired gate. */
export function GateReceiptRow({ receipt, telegram }: { receipt: GateReceipt; telegram?: boolean }) {
  const target = gateTarget(receipt.card);
  const time = receipt.at ? ` · ${formatClock(receipt.at)}` : "";
  let icon: React.ReactNode;
  let text: string;
  let tone = "text-muted-foreground";
  if (receipt.by === "timeout") {
    icon = <TimerOff aria-hidden className="size-4 text-subtle-foreground" />;
    text = "Abgelaufen – automatisch abgelehnt";
  } else if (receipt.by === "gone") {
    icon = <CircleSlash aria-hidden className="size-4 text-subtle-foreground" />;
    text = "Bereits entschieden oder abgelaufen";
  } else if (receipt.by === "other") {
    icon = receipt.decision === "allow" ? <Check aria-hidden className="size-4 text-success" /> : <X aria-hidden className="size-4 text-danger" />;
    text = `${telegram ? "Über Telegram entschieden" : "Anderswo entschieden"}: ${receipt.decision === "allow" ? "freigegeben" : "abgelehnt"}${time}`;
  } else if (receipt.decision === "allow") {
    icon = <Check aria-hidden className="size-4 text-success" />;
    text = receipt.card.kind === "plan" ? `Plan freigegeben${time}` : `Freigegeben${time}`;
    tone = "text-foreground";
  } else {
    icon = <X aria-hidden className="size-4 text-danger" />;
    const isAnswer = receipt.card.type === "question_request" && receipt.card.kind !== "plan" && receipt.reason?.startsWith("Der Nutzer hat geantwortet");
    text = isAnswer
      ? `Beantwortet${time}`
      : receipt.reason
        ? `Abgelehnt: ‚${receipt.reason.length > 80 ? `${receipt.reason.slice(0, 79)}…` : receipt.reason}'`
        : `Abgelehnt${time}`;
    tone = "text-foreground";
  }
  return (
    <div
      id={gateDomId(receipt.approvalId)}
      // Focus lands here after a decision (the card it replaces had focus).
      tabIndex={-1}
      className="flex min-h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-ui outline-none focus-visible:outline-2 focus-visible:outline-ring"
    >
      {icon}
      <span className={tone}>{text}</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-subtle-foreground">{target}</span>
    </div>
  );
}
