"use client";

import * as React from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Countdown } from "@/components/ui/countdown";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/components/ui/cn";
import { gateDomId, useGates } from "./gate-context";
import {
  SKIP_QUESTION_REASON,
  answerReason,
  chooseOption,
  chooseOther,
  openQuestionsReason,
  setOtherText,
} from "./question-logic";
import type { PendingCard } from "./run-events";

const OTHER = "__cm-other__";

const rowClass =
  "flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/60 has-[:focus-visible]:bg-accent/60";

/** Interactive question from the agent (AskUserQuestion), DESIGN.md §6.2.7. */
export function QuestionCard({ card }: { card: PendingCard }) {
  const { decide, answerOf, setAnswer } = useGates();
  const titleId = React.useId();
  const baseId = React.useId();
  const state = answerOf(card.approvalId);
  const qs = card.questions ?? [];
  const blocked = openQuestionsReason(card, state);
  const update = (f: Parameters<typeof setAnswer>[1]) => setAnswer(card.approvalId, f);
  const submit = () => {
    if (!openQuestionsReason(card, answerOf(card.approvalId))) decide(card, "deny", answerReason(card, answerOf(card.approvalId)));
  };

  return (
    <Card
      id={gateDomId(card.approvalId)}
      role="region"
      aria-labelledby={titleId}
      className="scroll-mt-4 overflow-hidden border-info-border shadow-sm"
      data-gate={card.approvalId}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-info-border bg-info-subtle px-3 py-2">
        <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-info" />
        <h2 id={titleId} tabIndex={-1} data-gate-heading className="text-ui font-semibold text-foreground outline-none">
          Frage vom Agenten
        </h2>
        {card.expiresAt ? <Countdown expiresAt={card.expiresAt} variant="ring" className="ml-auto" /> : null}
      </div>
      <div className="space-y-4 p-3">
        {qs.length === 0 ? <p className="text-ui text-muted-foreground">Der Agent hat keine Frage mitgeschickt.</p> : null}
        {qs.map((q, qi) => {
          const multi = !!q.multiSelect;
          const options = q.options ?? [];
          const sel = state.sel[qi] ?? [];
          const otherOn = !!state.otherOn[qi];
          const legend = q.header ? `${q.header}: ${q.question}` : q.question || `Frage ${qi + 1}`;
          const otherInputId = `${baseId}-${qi}-other`;
          const otherInput = (
            <Input
              id={otherInputId}
              aria-label={`Eigene Antwort: ${legend}`}
              placeholder={options.length ? "Eigene Antwort …" : "Deine Antwort …"}
              maxLength={2000}
              value={state.other[qi] ?? ""}
              onFocus={() => {
                if (options.length && !otherOn) update((s) => chooseOther(s, qi, multi));
              }}
              onChange={(e) => update((s) => setOtherText(s, qi, e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          );
          return (
            <fieldset key={qi} className="min-w-0 space-y-1.5">
              <legend className="mb-1 text-sm text-foreground md:text-ui">
                {q.header ? <span className="mr-1.5 text-xs font-medium text-subtle-foreground">{q.header}</span> : null}
                <span className="font-medium">{q.question || `Frage ${qi + 1}`}</span>
                {multi ? <span className="ml-1.5 text-xs text-muted-foreground">Mehrfachauswahl möglich</span> : null}
              </legend>
              {options.length === 0 ? (
                otherInput
              ) : multi ? (
                <div className="space-y-0.5">
                  {options.map((o, oi) => {
                    const id = `${baseId}-${qi}-${oi}`;
                    return (
                      <label key={oi} htmlFor={id} className={rowClass}>
                        <Checkbox id={id} checked={sel.includes(o.label)} onCheckedChange={() => update((s) => chooseOption(s, qi, o.label, true))} className="mt-0.5" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm md:text-ui">{o.label}</span>
                          {o.description ? <span className="text-xs text-muted-foreground">{o.description}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                  <label htmlFor={`${baseId}-${qi}-oc`} className={rowClass}>
                    <Checkbox id={`${baseId}-${qi}-oc`} checked={otherOn} onCheckedChange={(v) => update((s) => chooseOther(s, qi, true, v === true))} className="mt-0.5" />
                    <span className="text-sm md:text-ui">Eigene Antwort …</span>
                  </label>
                  {otherOn ? <div className="pl-9">{otherInput}</div> : null}
                </div>
              ) : (
                <RadioGroup
                  aria-label={legend}
                  value={otherOn ? OTHER : sel[0] ?? ""}
                  onValueChange={(v) => update((s) => (v === OTHER ? chooseOther(s, qi, false) : chooseOption(s, qi, v, false)))}
                  className="gap-0.5"
                >
                  {options.map((o, oi) => {
                    const id = `${baseId}-${qi}-${oi}`;
                    return (
                      <label key={oi} htmlFor={id} className={rowClass}>
                        <RadioGroupItem id={id} value={o.label} className="mt-0.5" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm md:text-ui">{o.label}</span>
                          {o.description ? <span className="text-xs text-muted-foreground">{o.description}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                  <label htmlFor={`${baseId}-${qi}-or`} className={rowClass}>
                    <RadioGroupItem id={`${baseId}-${qi}-or`} value={OTHER} className="mt-0.5" />
                    <span className="text-sm md:text-ui">Eigene Antwort …</span>
                  </label>
                  <div className={cn("pl-9", !otherOn && "hidden")}>{otherInput}</div>
                </RadioGroup>
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="hidden flex-wrap items-center gap-2 border-t border-border px-3 py-2.5 md:flex">
        <Button variant="primary" disabledReason={blocked ?? undefined} onClick={submit}>
          <Check aria-hidden />
          Antworten
        </Button>
        <Button variant="ghost" onClick={() => decide(card, "deny", SKIP_QUESTION_REASON)}>
          Überspringen
        </Button>
        {blocked ? <span className="ml-auto text-xs text-subtle-foreground">{blocked}</span> : null}
      </div>
    </Card>
  );
}
