"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, ShieldCheck, Timer, X } from "lucide-react";
import type { ApprovalEvent, Decide } from "./types";

// Diffs of huge writes are capped in the card (the full change still applies).
const MAX_DIFF_LINES = 1500;

/** Wall clock that ticks every second while mounted (only while cards exist). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Countdown({ expiresAt, now }: { expiresAt?: number; now: number }) {
  if (!expiresAt) return null;
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  const tone = left === 0 ? "text-red-500" : left < 60 ? "text-amber-500" : "text-muted-foreground";
  return (
    <span
      className={`ml-auto inline-flex items-center gap-1 text-[11px] font-normal tabular-nums shrink-0 ${tone}`}
      title="Verbleibende Zeit bis zur automatischen Ablehnung"
      aria-label={left === 0 ? "Abgelaufen" : `Noch ${mm} Minuten ${left % 60} Sekunden`}
    >
      <Timer size={11} /> {left === 0 ? "abgelaufen" : `${mm}:${ss}`}
    </span>
  );
}

/** Pending approval + question cards of the attached run. */
export function PendingGates({
  approvals,
  questions,
  onDecide,
}: {
  approvals: ApprovalEvent[];
  questions: ApprovalEvent[];
  onDecide: Decide;
}) {
  const now = useNow();
  return (
    <div className="mx-3 mt-2 space-y-2 max-h-[55vh] overflow-y-auto">
      {questions.map((q) => (
        <QuestionGate key={q.approvalId} card={q} now={now} onDecide={onDecide} />
      ))}
      {approvals.map((a) => (
        <ApprovalGate key={a.approvalId} card={a} now={now} onDecide={onDecide} />
      ))}
    </div>
  );
}

// Interactive questions: AskUserQuestion is answered by "denying" the tool with
// the chosen answer as reason (the model reads it and continues); ExitPlanMode
// "allow" approves the plan, "deny" sends it back.
function QuestionGate({ card, now, onDecide }: { card: ApprovalEvent; now: number; onDecide: Decide }) {
  const [sel, setSel] = useState<Record<number, string[]>>({});
  // Free-text answer per question ("Other", like the Claude Code CLI offers).
  const [other, setOther] = useState<Record<number, string>>({});

  if (card.kind === "plan") {
    return (
      <div className="rounded-md border border-violet-500/50 bg-violet-500/5 p-3 space-y-2 text-sm">
        <div className="flex items-center gap-1.5 font-medium text-violet-300">
          <ShieldCheck size={14} /> Plan freigeben
          <Countdown expiresAt={card.expiresAt} now={now} />
        </div>
        {card.plan && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-xs text-foreground/90">{card.plan}</pre>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onDecide(card, "allow")}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1">
            <Check size={13} /> Plan umsetzen
          </button>
          <button onClick={() => onDecide(card, "deny", "Der Nutzer hat den Plan abgelehnt. Bitte überarbeite ihn und frage ggf. nach.")}
            className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent flex items-center gap-1">
            <X size={13} /> Ablehnen
          </button>
        </div>
      </div>
    );
  }

  const qs = card.questions || [];
  const toggle = (qi: number, label: string, multi: boolean) => {
    setSel((prev) => {
      const cur = prev[qi] || [];
      if (multi) return { ...prev, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      return { ...prev, [qi]: [label] };
    });
  };
  const answerOf = (qi: number) => {
    const text = (other[qi] || "").trim();
    return [...(sel[qi] || []), ...(text ? [text] : [])];
  };
  const allAnswered = qs.length > 0 && qs.every((_, qi) => answerOf(qi).length > 0);
  const submit = () => {
    const lines = qs.map((q, qi) => `- ${q.header || q.question || `Frage ${qi + 1}`}: ${answerOf(qi).join(", ")}`);
    onDecide(card, "deny", `Der Nutzer hat geantwortet:\n${lines.join("\n")}`);
  };

  return (
    <div className="rounded-md border border-violet-500/50 bg-violet-500/5 p-3 space-y-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-violet-300">
        <AlertCircle size={14} /> Rückfrage
        <Countdown expiresAt={card.expiresAt} now={now} />
      </div>
      {qs.map((q, qi) => (
        <div key={qi} className="space-y-1.5">
          {q.header && <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{q.header}</div>}
          {q.question && <div className="text-sm">{q.question}{q.multiSelect ? " (Mehrfachauswahl)" : ""}</div>}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={q.header || q.question || `Frage ${qi + 1}`}>
            {q.options.map((o, oi) => {
              const active = (sel[qi] || []).includes(o.label);
              return (
                <button key={oi} onClick={() => toggle(qi, o.label, !!q.multiSelect)} title={o.description}
                  aria-pressed={active}
                  className={`px-2.5 py-1 text-xs rounded-md border text-left ${active ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
            placeholder={q.options.length ? "Andere Antwort (optional)…" : "Deine Antwort…"}
            aria-label={`Eigene Antwort: ${q.header || q.question || `Frage ${qi + 1}`}`}
            maxLength={2000}
            value={other[qi] || ""}
            onChange={(e) => setOther((prev) => ({ ...prev, [qi]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && allAnswered) { e.preventDefault(); submit(); }
            }}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button onClick={submit} disabled={!allAnswered}
          className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
          <Check size={13} /> Antwort senden
        </button>
        <button onClick={() => onDecide(card, "deny", "Der Nutzer möchte diese Frage nicht beantworten. Entscheide selbst sinnvoll oder frage anders.")}
          className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent flex items-center gap-1">
          <X size={13} /> Überspringen
        </button>
      </div>
    </div>
  );
}

function ApprovalGate({ card, now, onDecide }: { card: ApprovalEvent; now: number; onDecide: Decide }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isBash = card.tool === "Bash";
  const diff = card.diff || [];
  const shown = diff.length > MAX_DIFF_LINES ? diff.slice(0, MAX_DIFF_LINES) : diff;
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-1.5 font-semibold text-amber-500 min-w-0">
        <ShieldCheck size={14} className="shrink-0" />
        <span className="shrink-0">Freigabe nötig: {card.tool}</span>
        {card.filePath && <span className="font-normal text-xs text-muted-foreground truncate" title={card.filePath}>· {card.filePath}</span>}
        <Countdown expiresAt={card.expiresAt} now={now} />
      </div>
      {card.isWrite && (
        <div className={`text-[11px] ${card.overwrites ? "text-amber-400" : "text-muted-foreground"}`}>
          {card.overwrites ? "⚠ überschreibt bestehende Datei" : "neue Datei"}
        </div>
      )}
      {isBash ? (
        <pre className="bg-background/60 rounded p-2 text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto border border-border">{card.command}</pre>
      ) : (
        <pre className="bg-background/60 rounded p-2 text-xs max-h-64 overflow-auto border border-border leading-snug">
          {shown.map((d, i) => (
            <div key={i} className={
              d.op === "add" ? "text-green-500 bg-green-500/10"
                : d.op === "del" ? "text-red-500 bg-red-500/10"
                : "text-muted-foreground"
            }>
              <span className="select-none opacity-60">{d.op === "add" ? "+ " : d.op === "del" ? "- " : "  "}</span>
              {d.text || " "}
            </div>
          ))}
          {diff.length > shown.length && (
            <div className="text-muted-foreground italic">… {diff.length - shown.length} weitere Zeilen</div>
          )}
        </pre>
      )}
      {reasonOpen && (
        <textarea
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm resize-none min-h-[44px]"
          placeholder="Hinweis an den Assistenten (warum abgelehnt / was stattdessen tun)…"
          aria-label="Hinweis zur Ablehnung"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onDecide(card, "allow")}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-green-600 text-white hover:bg-green-500"
        >
          <Check size={13} /> Freigeben
        </button>
        {reasonOpen ? (
          <button
            onClick={() => onDecide(card, "deny", reason.trim() || undefined)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-destructive text-white hover:opacity-90"
          >
            <X size={13} /> Ablehnen + Hinweis senden
          </button>
        ) : (
          <>
            <button
              onClick={() => onDecide(card, "deny")}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent"
            >
              <X size={13} /> Ablehnen
            </button>
            <button
              onClick={() => setReasonOpen(true)}
              className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent"
            >
              Ablehnen mit Hinweis…
            </button>
          </>
        )}
      </div>
    </div>
  );
}
