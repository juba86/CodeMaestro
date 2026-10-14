"use client";

import * as React from "react";
import { CalendarClock, Link2, MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { confirm } from "@/components/ui/confirm";
import { copyText } from "@/components/ui/copy-text";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch, SwitchRow } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatClock, formatRelative } from "@/lib/format";
import { approvalModeLabel, permissionModeLabel, runKindLabel } from "@/lib/labels";
import { describeCron, isValidCron, nextCronRuns } from "@/lib/schedule/cron";
import { SCHEDULE_TEMPLATES } from "@/lib/schedule/templates";
import { scheduleStatusLabel, type ScheduleInput, type ScheduleView } from "@/lib/schedule/types";
import { LoopSettings } from "./loop-popover";
import {
  RHYTHM_CUSTOM,
  RHYTHM_NONE,
  draftFrom,
  draftProblem,
  draftToInput,
  formatUntil,
  nextRunLabel,
  rhythmChoiceFor,
  rhythmLabel,
  rhythmOptions,
  scheduleSummary,
  sortSchedules,
  statusTone,
  webhookUrl,
  type ScheduleDraft,
} from "./schedule-logic";
import type { SessionInfo } from "./types";

// --- Data ----------------------------------------------------------------------------

export interface SchedulesState {
  schedules: ScheduleView[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const EMPTY: ScheduleView[] = [];

async function readError(res: Response | null, fallback: string): Promise<string> {
  if (!res) return "Server nicht erreichbar.";
  const d = (await res.json().catch(() => ({}))) as { error?: string };
  return d.error || fallback;
}

/** The schedules of one session; `refresh()` after mutations and run ends. */
export function useSchedules(sessionId: string | null): SchedulesState {
  const [schedules, setSchedules] = React.useState<ScheduleView[]>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const seq = React.useRef(0);
  const refresh = React.useCallback(async () => {
    if (!sessionId) {
      setSchedules(EMPTY);
      return;
    }
    const n = ++seq.current;
    try {
      const res = await fetch(`/api/assistant/schedules?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { schedules?: ScheduleView[] };
      if (n !== seq.current) return;
      const next = Array.isArray(d.schedules) ? d.schedules : EMPTY;
      setSchedules((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch {
      /* keep the last list */
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [sessionId]);
  React.useEffect(() => {
    setLoading(!!sessionId);
    setSchedules(EMPTY);
    void refresh();
  }, [refresh, sessionId]);
  return { schedules, loading, refresh };
}

// --- Panel (inspector tab) --------------------------------------------------------------

export interface SchedulePanelProps {
  sessionId: string | null;
  schedules: ScheduleView[];
  loading: boolean;
  now: number;
  onNew: () => void;
  onEdit: (s: ScheduleView) => void;
  /** Reload after a toggle, a manual run or a delete. */
  onChanged: () => void;
}

function ScheduleRow({ s, now, onEdit, onChanged }: { s: ScheduleView; now: number; onEdit: (s: ScheduleView) => void; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const patch = async (body: Partial<ScheduleInput>) => {
    setBusy(true);
    const res = await fetch(`/api/assistant/schedules/${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) toast.error(await readError(res, "Zeitplan konnte nicht gespeichert werden."));
    onChanged();
  };
  const runNow = async () => {
    setBusy(true);
    const res = await fetch(`/api/assistant/schedules/${encodeURIComponent(s.id)}/run`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (res?.ok) toast.success(`„${s.name}“ gestartet.`);
    else toast.error(await readError(res, "Lauf konnte nicht gestartet werden."));
    onChanged();
  };
  const remove = async () => {
    const ok = await confirm({
      title: "Zeitplan löschen?",
      description: `„${s.name}“ wird nicht mehr ausgeführt. Bisherige Läufe bleiben im Verlauf der Session.`,
      confirmLabel: "Löschen",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/assistant/schedules/${encodeURIComponent(s.id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) toast.success("Zeitplan gelöscht.");
    else toast.error(await readError(res, "Zeitplan konnte nicht gelöscht werden."));
    onChanged();
  };
  const copyHook = async () => {
    const ok = await copyText(webhookUrl(window.location.origin, s.triggerToken));
    if (ok) toast.success("Webhook-URL kopiert. Ein POST darauf startet den Zeitplan; der Body geht an den Agenten.");
    else toast.error("Kopieren fehlgeschlagen.");
  };
  const status = s.lastStatus;
  const running = status === "running";
  return (
    <li className={cn("rounded-lg border border-border bg-card p-3", !s.enabled && "opacity-75")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium text-foreground">{s.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {rhythmLabel(s)} · {runKindLabel(s.mode)}
            {s.onlyIfChanged && s.cron ? " · nur bei Änderungen" : ""}
          </p>
        </div>
        <Switch
          size="sm"
          aria-label={`${s.name} ${s.enabled ? "ausschalten" : "einschalten"}`}
          checked={s.enabled}
          disabled={busy}
          onCheckedChange={(v) => void patch({ enabled: v })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={`Aktionen für ${s.name}`} size="icon-sm" disabled={busy}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void runNow()} disabled={running}>
              <Play />
              Jetzt ausführen
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit(s)}>
              <Pencil />
              Bearbeiten
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyHook()}>
              <Link2 />
              Webhook-URL kopieren
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" onSelect={() => void remove()}>
              <Trash2 />
              Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className={cn("mt-2 text-xs", running ? "text-primary-text" : "text-muted-foreground")}>{nextRunLabel(s, now)}</p>
      {status || s.runCount > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={statusTone(status)}>{scheduleStatusLabel(status)}</Badge>
          {s.lastRunAt ? <span>{formatRelative(s.lastRunAt, now)}</span> : null}
          {s.runCount > 0 ? (
            <span>
              · {s.runCount} {s.runCount === 1 ? "Lauf" : "Läufe"}
              {s.maxRuns ? ` von ${s.maxRuns}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      {s.lastSummary ? (
        <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground" title={s.lastSummary}>
          {s.lastSummary}
        </p>
      ) : null}
    </li>
  );
}

/** Inspector tab „Zeitpläne": the session's schedules with switch, next run and last outcome. */
export function SchedulePanel({ sessionId, schedules, loading, now, onNew, onEdit, onChanged }: SchedulePanelProps) {
  if (!sessionId) return null;
  if (loading && schedules.length === 0) {
    return (
      <div className="space-y-2" aria-busy>
        <span className="sr-only" role="status">
          Zeitpläne werden geladen …
        </span>
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }
  if (schedules.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock />}
        title="Noch kein Zeitplan"
        description="Ein Zeitplan lässt diese Session ihre Aufgabe von selbst erledigen – nach Uhrzeit oder per Webhook – und meldet dir das Ergebnis."
        action={
          <Button variant="primary" onClick={onNew}>
            <Plus aria-hidden />
            Zeitplan anlegen
          </Button>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-2" aria-label="Zeitpläne">
        {sortSchedules(schedules).map((s) => (
          <ScheduleRow key={s.id} s={s} now={now} onEdit={onEdit} onChanged={onChanged} />
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={onNew}>
        <Plus aria-hidden />
        Zeitplan anlegen
      </Button>
      <p className="text-xs text-subtle-foreground">Zeiten gelten in der Zeitzone des Servers. Läufe erscheinen im Verlauf dieser Session.</p>
    </div>
  );
}

// --- Editor sheet -------------------------------------------------------------------------

export interface ScheduleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  info: SessionInfo | null;
  /** Edit this schedule (null = create). */
  editing: ScheduleView | null;
  /** Prefill for a new schedule (e.g. the composer text). */
  initial?: Partial<ScheduleInput>;
  onSaved: (s: ScheduleView) => void;
}

/** "in 2 Std. (11:00)" · "morgen 02:00" (already carries the clock). */
function untilWithClock(d: Date, now: number): string {
  const until = formatUntil(d, now);
  return until.includes(":") ? until : `${until} (${formatClock(d)})`;
}

function CronField({ draft, onChange, now }: { draft: ScheduleDraft; onChange: (d: ScheduleDraft) => void; now: number }) {
  const choice = rhythmChoiceFor(draft.cron);
  const [custom, setCustom] = React.useState(choice === RHYTHM_CUSTOM);
  const showInput = custom || choice === RHYTHM_CUSTOM;
  const valid = !draft.cron.trim() || isValidCron(draft.cron);
  const upcoming = React.useMemo(() => {
    if (!draft.cron.trim() || !valid || now === 0) return [];
    try {
      return nextCronRuns(draft.cron, 3, now);
    } catch {
      return [];
    }
  }, [draft.cron, valid, now]);
  return (
    <Field invalid={!valid}>
      <FieldLabel>Rhythmus</FieldLabel>
      <SimpleSelect
        aria-label="Rhythmus"
        options={rhythmOptions()}
        value={showInput && draft.cron.trim() ? RHYTHM_CUSTOM : choice}
        onValueChange={(v) => {
          if (v === RHYTHM_NONE) {
            setCustom(false);
            onChange({ ...draft, cron: "" });
          } else if (v === RHYTHM_CUSTOM) {
            setCustom(true);
            if (!draft.cron.trim()) onChange({ ...draft, cron: "0 9 * * *" });
          } else {
            setCustom(false);
            onChange({ ...draft, cron: v });
          }
        }}
      />
      {showInput ? (
        <Input
          className="font-mono"
          aria-label="Cron-Ausdruck"
          placeholder="Minute Stunde Tag Monat Wochentag"
          value={draft.cron}
          onChange={(e) => onChange({ ...draft, cron: e.target.value })}
        />
      ) : null}
      {!valid ? (
        <FieldError>Ungültiger Cron-Ausdruck – fünf Felder: Minute Stunde Tag Monat Wochentag, z. B. „0 9 * * 1-5“.</FieldError>
      ) : draft.cron.trim() ? (
        <FieldHint>
          {describeCron(draft.cron)}
          {upcoming.length ? ` · nächste: ${upcoming.map((d) => untilWithClock(d, now)).join(", ")}` : ""}
        </FieldHint>
      ) : (
        <FieldHint>Ohne Rhythmus startet der Zeitplan nur, wenn seine Webhook-URL aufgerufen wird.</FieldHint>
      )}
    </Field>
  );
}

export function ScheduleSheet({ open, onOpenChange, sessionId, info, editing, initial, onSaved }: ScheduleSheetProps) {
  const [draft, setDraft] = React.useState<ScheduleDraft>(() => draftFrom(initial));
  const [saving, setSaving] = React.useState(false);
  const [template, setTemplate] = React.useState("");
  const now = Date.now();

  // A fresh draft every time the sheet opens (edit → its values; new → prefill).
  React.useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(editing ?? initial));
    setTemplate("");
    // The prefill object changes identity on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const problem = draftProblem(draft);
  const applyTemplate = (id: string) => {
    setTemplate(id);
    const t = SCHEDULE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setDraft((d) => ({ ...d, ...draftFrom({ ...draftToInput(d), ...t.input }) }));
  };

  async function save() {
    if (!sessionId || problem) return;
    setSaving(true);
    const body = draftToInput(draft);
    const res = await fetch(editing ? `/api/assistant/schedules/${encodeURIComponent(editing.id)}` : "/api/assistant/schedules", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? body : { sessionId, ...body }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      toast.error(await readError(res, "Zeitplan konnte nicht gespeichert werden."));
      return;
    }
    const d = (await res.json().catch(() => ({}))) as { schedule?: ScheduleView };
    if (d.schedule) onSaved(d.schedule);
    toast.success(editing ? "Zeitplan gespeichert." : `Zeitplan „${body.name}“ angelegt.`);
    onOpenChange(false);
  }

  const rights = info ? `${permissionModeLabel(info.permissionMode)} · Freigaben: ${approvalModeLabel(info.approvalMode)}` : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="auto" size="lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Zeitplan bearbeiten" : "Zeitplan anlegen"}</SheetTitle>
          <SheetDescription>Die Session erledigt die Aufgabe von selbst – nach Uhrzeit oder per Webhook – und meldet das Ergebnis.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5 pb-4">
          {!editing ? (
            <Field>
              <FieldLabel>Vorlage</FieldLabel>
              <SimpleSelect
                aria-label="Vorlage"
                placeholder="Ohne Vorlage"
                options={SCHEDULE_TEMPLATES.map((t) => ({ value: t.id, label: t.name, description: t.description }))}
                value={template}
                onValueChange={applyTemplate}
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input maxLength={80} placeholder="z. B. Nächtlicher Testlauf" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel>Aufgabe</FieldLabel>
            <Textarea
              autosize={{ min: 4, max: 14 }}
              placeholder="Was soll der Agent bei jedem Lauf tun? Schreib auch, was er nicht tun soll und wie der Bericht aussehen soll."
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
            <FieldHint>Der Agent arbeitet unbeaufsichtigt: Er stellt keine Rückfragen und schließt mit einem kurzen Bericht ab, dessen erste Zeile die Benachrichtigung wird.</FieldHint>
          </Field>
          <CronField draft={draft} onChange={setDraft} now={now} />
          <Field>
            <FieldLabel id="schedule-mode-label">Modus</FieldLabel>
            <SegmentedControl aria-labelledby="schedule-mode-label" stretch value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as ScheduleDraft["mode"] })}>
              <SegmentedItem value="turn">Direkt</SegmentedItem>
              <SegmentedItem value="loop">Loop</SegmentedItem>
              <SegmentedItem value="orchestrate">Orchester</SegmentedItem>
            </SegmentedControl>
            <FieldHint>
              {draft.mode === "loop"
                ? "Die Aufgabe wird je Lauf wiederholt, bis der Agent das Abschlusssignal ausgibt."
                : draft.mode === "orchestrate"
                  ? "Der Dirigent verteilt die Aufgabe auf die Rollen des gespeicherten Orchesters."
                  : "Ein Durchgang des Agenten der Session je Lauf."}
            </FieldHint>
          </Field>
          {draft.mode === "loop" ? (
            <div className="rounded-lg border border-border p-3">
              <LoopSettings value={draft.loop} onChange={(loop) => setDraft({ ...draft, loop })} />
            </div>
          ) : null}
          <div className="space-y-1">
            <SwitchRow
              label="Nur wenn sich das Projekt geändert hat"
              description="Ein Lauf nach Uhrzeit entfällt, solange Commits und Arbeitsstand seit dem letzten Lauf gleich sind (Git)."
              checked={draft.onlyIfChanged}
              onCheckedChange={(v) => setDraft({ ...draft, onlyIfChanged: v })}
            />
            <SwitchRow label="Wissensbasis nutzen" description="Passende Dokumente aus der Wissensbasis werden der Aufgabe beigelegt." checked={draft.useKnowledge} onCheckedChange={(v) => setDraft({ ...draft, useKnowledge: v })} />
          </div>
          <Field>
            <FieldLabel id="schedule-busy-label">Wenn die Session gerade arbeitet</FieldLabel>
            <SegmentedControl aria-labelledby="schedule-busy-label" stretch value={draft.onBusy} onValueChange={(v) => setDraft({ ...draft, onBusy: v as ScheduleDraft["onBusy"] })}>
              <SegmentedItem value="skip">Überspringen</SegmentedItem>
              <SegmentedItem value="wait">Warten</SegmentedItem>
            </SegmentedControl>
            <FieldHint>{draft.onBusy === "wait" ? "Der Lauf startet, sobald die Session frei ist." : "Der Lauf entfällt; der nächste Termin gilt."}</FieldHint>
          </Field>
          <div className="space-y-1">
            <p className="text-ui font-medium">Benachrichtigen, wenn ein Lauf endet</p>
            <SwitchRow label="Push" description="Auf jedem Gerät mit aktivierten Benachrichtigungen." checked={draft.notifyPush} onCheckedChange={(v) => setDraft({ ...draft, notifyPush: v })} />
            <SwitchRow label="Telegram" description="Bericht an alle freigeschalteten Chats der Telegram-Brücke." checked={draft.notifyTelegram} onCheckedChange={(v) => setDraft({ ...draft, notifyTelegram: v })} />
          </div>
          <Field>
            <FieldLabel>Max. Läufe (optional)</FieldLabel>
            <Input type="number" inputMode="numeric" min={1} placeholder="unbegrenzt" className="w-40 tabular-nums" value={draft.maxRuns} onChange={(e) => setDraft({ ...draft, maxRuns: e.target.value })} />
            <FieldHint>Danach schaltet sich der Zeitplan aus. Nach drei Fehlern in Folge pausiert er von selbst.</FieldHint>
          </Field>
          {rights ? (
            <Callout variant="info" title="Rechte der Session">
              Jeder Lauf arbeitet mit den Einstellungen dieser Session: {rights}. Freigaben warten wie gewohnt – bis zu 30 Minuten, dann werden sie abgelehnt.
            </Callout>
          ) : null}
          {editing ? (
            <Field>
              <FieldLabel>Webhook</FieldLabel>
              <div className="flex gap-2">
                <Input readOnly className="font-mono text-xs" value={typeof window !== "undefined" ? webhookUrl(window.location.origin, editing.triggerToken) : ""} />
                <Button
                  variant="outline"
                  onClick={() => void copyText(webhookUrl(window.location.origin, editing.triggerToken)).then((ok) => (ok ? toast.success("Kopiert") : toast.error("Kopieren fehlgeschlagen.")))}
                >
                  Kopieren
                </Button>
              </div>
              <FieldHint>Ein POST auf diese URL startet den Zeitplan (auch ohne Rhythmus). Der Body – etwa ein GitHub-Event oder ein CI-Fehler – geht als Kontext an den Agenten.</FieldHint>
            </Field>
          ) : null}
        </SheetBody>
        <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 truncate text-ui text-muted-foreground sm:flex-1" aria-live="polite">
            {scheduleSummary(draftToInput(draft))}
          </p>
          <Button variant="primary" size="lg" className="shrink-0" onClick={() => void save()} loading={saving} disabledReason={problem ?? undefined}>
            <CalendarClock aria-hidden />
            {editing ? "Änderungen speichern" : "Zeitplan speichern"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
