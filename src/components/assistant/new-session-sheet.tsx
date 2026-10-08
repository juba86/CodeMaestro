"use client";

import * as React from "react";
import { ArrowRight, ChevronRight, History, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ProviderDot, providerTone } from "@/components/ui/provider-mark";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { SELECTABLE_TOOLS } from "@/lib/assistant/tool-rules";
import { formatRelative } from "@/lib/format";
import { approvalModeLabel, permissionModeLabel, toolLabel } from "@/lib/labels";
import { FolderBrowser, useBrowse } from "./folder-browser";
import {
  AGENTS,
  APPROVAL_CAPABLE,
  CONVERSATIONS_COLLAPSED,
  NEW_CONVERSATION,
  NEW_SESSION_STORAGE_KEY,
  PRESET_DESCRIPTION,
  PRESET_LABEL,
  SANDBOX_CAPABLE,
  agentLabel,
  alreadyLinkedSessionId,
  applyPreset,
  capabilityFields,
  capabilityNote,
  chipPressed,
  commandRulesHint,
  conversationAction,
  conversationChoice,
  conversationTitle,
  conversationsUrl,
  defaultPreset,
  draftSummary,
  matchPreset,
  needsAutonomyConsent,
  offersResume,
  parseConversations,
  parseStoredDraft,
  presetDisabledReason,
  resumeFields,
  startLabel,
  switchAgent,
  toggleChip,
  toolChips,
  ungatedWarning,
  visibleConversations,
  type ApprovalMode,
  type ClaudeConversation,
  type ConversationPick,
  type PermissionPreset,
  type SessionDraft,
} from "./new-session";
import { PiInstallHint, SMALL_CONTEXT, formatContext, sortPiModels, usePiStatus } from "./pi-status";
import { folderName, recentFolders, shortPath } from "./session-list";
import type { SessionSummary } from "./types";

const FALLBACK_TOOLS = [...SELECTABLE_TOOLS];
const FALLBACK_MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
/** Wait while the user clicks through folders before asking for their conversations. */
const CONVERSATIONS_DEBOUNCE_MS = 250;
const CONVERSATIONS_TIMEOUT_MS = 8000;

/** The folder's Claude Code conversations as last loaded (`cwd` = the folder they belong to). */
interface ConversationList {
  cwd: string;
  list: ClaudeConversation[];
  failed: boolean;
}

function initialDraft(): SessionDraft {
  return applyPreset({ provider: "claude", model: "", permissionMode: "default", allowedTools: [], approvalMode: "off", sandbox: false }, "gated");
}

export interface NewSessionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionSummary[];
  /** Preselected folder (?cwd=). */
  initialCwd?: string | null;
  /** Session title from a handoff. */
  title?: string;
  onCreated: (sessionId: string) => void;
}

/** New Session sheet (DESIGN.md §6.2.3): folder, agent, conversation to continue, model, permissions, advanced. */
export function NewSessionSheet({ open, onOpenChange, sessions, initialCwd, title, onCreated }: NewSessionSheetProps) {
  const [draft, setDraft] = React.useState<SessionDraft>(initialDraft);
  const [cwd, setCwd] = React.useState("");
  const [tools, setTools] = React.useState<string[]>(FALLBACK_TOOLS);
  const [modes, setModes] = React.useState<string[]>(FALLBACK_MODES);
  const [advanced, setAdvanced] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const { browse, error: browseError, load } = useBrowse(setCwd);
  const recent = React.useMemo(() => recentFolders(sessions, 5), [sessions]);
  // „Projekt fortsetzen": the folder's Claude Code conversations and the user's pick.
  const [conversations, setConversations] = React.useState<ConversationList | null>(null);
  const [pick, setPick] = React.useState<ConversationPick | null>(null);
  const [expandedCwd, setExpandedCwd] = React.useState<string | null>(null);

  // Restore the remembered settings and open the folder each time the sheet opens.
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    let cancelled = false;
    (async () => {
      const ws = (await fetch("/api/assistant/workspaces", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null)) as { tools?: string[]; permissionModes?: string[] } | null;
      if (cancelled) return;
      const t = ws?.tools?.length ? ws.tools : FALLBACK_TOOLS;
      const m = ws?.permissionModes?.length ? ws.permissionModes : FALLBACK_MODES;
      setTools(t);
      setModes(m);
      let stored: ReturnType<typeof parseStoredDraft> = {};
      try {
        stored = parseStoredDraft(localStorage.getItem(NEW_SESSION_STORAGE_KEY), t, m);
      } catch {
        /* storage unavailable */
      }
      const base = initialDraft();
      const provider = stored.provider ?? base.provider;
      let next: SessionDraft = { ...base, ...stored, provider };
      if (!stored.allowedTools) next = applyPreset({ ...next, provider }, defaultPreset(provider));
      next = switchAgent(next, provider); // re-applies capability limits
      next = { ...next, model: stored.model ?? "" };
      setDraft(next);
      setConsent(false);
      const target = initialCwd || stored.cwd;
      if (!(target && (await load(target)))) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialCwd, load]);

  // Load the folder's conversations (debounced while browsing; a stale answer is aborted).
  const resumable = open && offersResume(draft.provider, cwd);
  React.useEffect(() => {
    if (!resumable) return;
    const ctrl = new AbortController();
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      timeout = setTimeout(() => ctrl.abort(), CONVERSATIONS_TIMEOUT_MS);
      let next: ConversationList;
      try {
        const res = await fetch(conversationsUrl(cwd), { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        next = { cwd, list: parseConversations(await res.json()), failed: false };
      } catch {
        // Not fatal: the session simply starts a new conversation.
        next = { cwd, list: [], failed: true };
      } finally {
        clearTimeout(timeout);
      }
      if (!cancelled) setConversations(next);
    }, CONVERSATIONS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [resumable, cwd]);

  const loaded = resumable && conversations?.cwd === cwd ? conversations : null;
  const conversationList = loaded?.list ?? [];
  const conversationsLoading = resumable && !loaded;
  const choice = conversationChoice(pick, cwd, conversationList);
  const action = conversationAction(draft.provider, choice, conversationList);
  const expanded = expandedCwd === cwd;
  const shownConversations = visibleConversations(conversationList, choice, expanded);
  const linkedTitle =
    action.kind === "open" ? sessions.find((s) => s.id === action.sessionId)?.title || conversationTitle(action.conversation) : "";

  // Closing forgets the conversations and the pick: the next open lists them
  // afresh (one may have been linked meanwhile) and preselects the newest again.
  function changeOpen(next: boolean) {
    if (!next) {
      setConversations(null);
      setPick(null);
      setExpandedCwd(null);
    }
    onOpenChange(next);
  }

  /** Opens the CodeMaestro session that already continues the conversation. */
  function openLinked(sessionId: string) {
    changeOpen(false);
    onCreated(sessionId);
  }

  const isPi = draft.provider === "pi";
  const pi = usePiStatus(open && isPi);
  const piModels = pi.status ? sortPiModels(pi.status.models) : [];
  const piModel = piModels.find((m) => m.id === draft.model) ?? piModels[0] ?? null;
  const piBlocked = isPi && (!pi.status?.installed || !piModel);

  const preset = matchPreset(draft);
  const consentNeeded = needsAutonomyConsent(draft);
  const warning = ungatedWarning(draft);
  const rulesHint = commandRulesHint(draft);
  const gateOk = APPROVAL_CAPABLE.has(draft.provider);
  const sandboxOk = SANDBOX_CAPABLE.has(draft.provider);

  const startReason = !cwd
    ? "Erst einen Projektordner wählen."
    : action.kind === "open"
      ? undefined // opening an existing session needs none of the checks below
      : conversationsLoading
        ? "Bisherige Unterhaltungen werden geladen …"
        : isPi && !pi.status?.installed
          ? "pi ist auf dem Server nicht installiert."
          : piBlocked
            ? "Erst ein lokales Modell wählen."
            : consentNeeded && !consent
              ? "Bitte bestätigen, dass Befehle ohne Rückfrage laufen."
              : undefined;

  async function create() {
    if (startReason) return;
    if (action.kind === "open") {
      openLinked(action.sessionId);
      return;
    }
    setCreating(true);
    try {
      const body = {
        provider: draft.provider,
        model: isPi ? piModel?.id ?? "" : draft.model.trim(),
        cwd,
        permissionMode: draft.permissionMode,
        allowedTools: draft.allowedTools.join(","),
        // Never send a gate or sandbox the agent cannot honour (the server rejects it).
        ...capabilityFields(draft),
        // Continue the chosen Claude Code conversation (`--resume`); its title
        // becomes the session title unless a handoff brought one.
        ...resumeFields(action),
        ...(title ? { title: title.slice(0, 200) } : {}),
      };
      const res = await fetch("/api/assistant/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      const linkedId = alreadyLinkedSessionId(res.status, d);
      if (linkedId) {
        // Another session took the conversation meanwhile: go there instead.
        toast.info(d.error || "Diese Unterhaltung ist schon in CodeMaestro geöffnet.");
        openLinked(linkedId);
        return;
      }
      if (!res.ok || !d.session?.id) {
        toast.error(d.error || "Konnte Session nicht anlegen.");
        return;
      }
      try {
        localStorage.setItem(NEW_SESSION_STORAGE_KEY, JSON.stringify({ ...draft, cwd }));
      } catch {
        /* storage unavailable */
      }
      toast.success(action.kind === "resume" ? "Session angelegt – Claude Code setzt die Unterhaltung fort." : "Session angelegt.");
      changeOpen(false);
      onCreated(d.session.id);
    } finally {
      setCreating(false);
    }
  }

  const chips = React.useMemo(() => toolChips(tools, toolLabel), [tools]);

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent side="auto">
        <SheetHeader>
          <SheetTitle>Neue Session</SheetTitle>
          <SheetDescription>Ein Agent arbeitet in einem Projektordner auf dem Server.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6 pb-4">
          {/* 1. Projektordner */}
          <section className="space-y-2" aria-labelledby="ns-folder">
            <h3 id="ns-folder" className="text-sm font-semibold md:text-ui">
              Projektordner
            </h3>
            {recent.length ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Zuletzt verwendet">
                {recent.map((p) => (
                  <ToggleChip key={p} pressed={cwd === p} onPressedChange={() => void load(p)} title={shortPath(p)}>
                    {folderName(p)}
                  </ToggleChip>
                ))}
              </div>
            ) : null}
            <FolderBrowser browse={browse} error={browseError} onNavigate={load} />
          </section>

          {/* 2. Agent */}
          <section className="space-y-2" aria-labelledby="ns-agent">
            <h3 id="ns-agent" className="text-sm font-semibold md:text-ui">
              Agent
            </h3>
            <RadioGroup
              aria-labelledby="ns-agent"
              value={draft.provider}
              onValueChange={(p) => {
                setDraft((prev) => switchAgent(prev, p));
                setConsent(false);
              }}
              className="grid grid-cols-2 gap-1.5"
            >
              {AGENTS.map((a) => (
                <RadioGroupTile key={a} value={a} label={agentLabel(a)} />
              ))}
            </RadioGroup>
            <p className="text-ui text-muted-foreground">{capabilityNote(draft.provider)}</p>
          </section>

          {/* 2b. Bisherige Unterhaltung fortsetzen (Claude Code only) */}
          {conversationList.length ? (
            <section className="space-y-2" aria-labelledby="ns-resume">
              <h3 id="ns-resume" className="text-sm font-semibold md:text-ui">
                Bisherige Unterhaltung fortsetzen
              </h3>
              <RadioGroup aria-labelledby="ns-resume" value={choice} onValueChange={(id) => setPick({ cwd, id })} className="gap-1.5">
                {shownConversations.map((c) => (
                  <RadioCard
                    key={c.id}
                    value={c.id}
                    title={<span className="line-clamp-1 [overflow-wrap:anywhere]">{conversationTitle(c)}</span>}
                    description={`${formatRelative(c.updatedAt)}${c.linkedSessionId ? " · schon in CodeMaestro geöffnet" : ""}`}
                    className="min-h-11 p-2.5"
                  />
                ))}
                <RadioCard
                  value={NEW_CONVERSATION}
                  title="Neue Unterhaltung starten"
                  description="Claude Code beginnt ohne den bisherigen Verlauf."
                  className="min-h-11 p-2.5"
                />
              </RadioGroup>
              {/* Outside the RadioGroup: a plain button among its roving-focus
                  items traps Shift+Tab between itself and the checked card. */}
              {conversationList.length > CONVERSATIONS_COLLAPSED ? (
                <Button
                  variant="ghost"
                  className="min-h-11 w-full justify-start text-muted-foreground md:min-h-10"
                  aria-expanded={expanded}
                  onClick={() => setExpandedCwd(expanded ? null : cwd)}
                >
                  <ChevronRight aria-hidden className={cn("transition-transform", expanded && "rotate-90")} />
                  {expanded ? "Weniger anzeigen" : `Ältere anzeigen (${conversationList.length - CONVERSATIONS_COLLAPSED})`}
                </Button>
              ) : null}
              {action.kind === "open" ? (
                <Callout
                  title="Schon in CodeMaestro geöffnet"
                  action={
                    <Button variant="secondary" onClick={() => openLinked(action.sessionId)}>
                      <ArrowRight aria-hidden />
                      Öffnen
                    </Button>
                  }
                >
                  Diese Unterhaltung läuft in der Session „{linkedTitle}“ weiter. Öffne sie dort, statt eine zweite Session anzulegen.
                </Callout>
              ) : action.kind === "resume" ? (
                <p className="text-ui text-muted-foreground">Claude Code setzt den bisherigen Verlauf fort (--resume).</p>
              ) : null}
            </section>
          ) : loaded?.failed ? (
            <p className="text-ui text-muted-foreground">Bisherige Unterhaltungen konnten nicht geladen werden – die Session beginnt neu.</p>
          ) : null}

          {/* 3. Modell */}
          <section className="space-y-2">
            {isPi ? (
              <Field>
                <FieldLabel>Lokales Modell</FieldLabel>
                <div className="flex gap-1.5">
                  <Select value={piModel?.id ?? ""} onValueChange={(v) => setDraft({ ...draft, model: v })} disabled={piModels.length === 0}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={pi.loading ? "Lade lokale Modelle …" : "Keine lokalen Modelle gefunden"} />
                    </SelectTrigger>
                    <SelectContent>
                      {piModels.some((m) => m.toolsOk) ? (
                        <SelectGroup>
                          <SelectLabel>Kann Dateien bearbeiten</SelectLabel>
                          {piModels
                            .filter((m) => m.toolsOk)
                            .map((m) => (
                              <SelectItem key={m.id} value={m.id} description={`Kontext ${formatContext(m.contextWindow)}`}>
                                {m.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ) : null}
                      {piModels.some((m) => !m.toolsOk) ? (
                        <SelectGroup>
                          <SelectLabel>Nur Text (keine Tools)</SelectLabel>
                          {piModels
                            .filter((m) => !m.toolsOk)
                            .map((m) => (
                              <SelectItem key={m.id} value={m.id} description={`Kontext ${formatContext(m.contextWindow)} · nur Text`}>
                                {m.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <IconButton aria-label="Lokale Modelle neu synchronisieren" variant="outline" loading={pi.loading} onClick={() => void pi.refresh(true)}>
                    <RefreshCw />
                  </IconButton>
                </div>
                {piModel ? (
                  <FieldHint>
                    {piModel.toolsOk ? "Kann Dateien bearbeiten" : <span className="text-warning">Ohne Tool-Unterstützung – antwortet nur in Text, keine Datei-Edits</span>}
                    {piModel.reasoning ? " · Thinking" : ""}
                    {piModel.vision ? " · Vision" : ""}
                    {" · "}
                    <span className={piModel.contextWindow > 0 && piModel.contextWindow < SMALL_CONTEXT ? "text-warning" : undefined}>
                      Kontext {formatContext(piModel.contextWindow)}
                      {piModel.contextWindow > 0 && piModel.contextWindow < SMALL_CONTEXT ? " – knapp für Agenten-Arbeit" : ""}
                    </span>
                  </FieldHint>
                ) : null}
              </Field>
            ) : (
              <Field>
                <FieldLabel optional="optional">Modell</FieldLabel>
                <Input placeholder="Standard" value={draft.model} maxLength={200} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
                <FieldHint>Leer = Standard des Agenten, z. B. „opus“ oder „sonnet“.</FieldHint>
              </Field>
            )}
            {isPi && pi.error ? <p className="text-ui text-danger">{pi.error}</p> : null}
            {isPi && pi.status && !pi.status.installed ? <PiInstallHint hint={pi.status.installHint} compact /> : null}
            {isPi && pi.status?.error ? <p className="text-ui text-warning">{pi.status.error}</p> : null}
          </section>

          {/* 4. Berechtigungen */}
          <section className="space-y-2" aria-labelledby="ns-perm">
            <h3 id="ns-perm" className="text-sm font-semibold md:text-ui">
              Berechtigungen
            </h3>
            <RadioGroup
              aria-labelledby="ns-perm"
              value={preset ?? ""}
              onValueChange={(v) => {
                setDraft((prev) => applyPreset(prev, v as PermissionPreset));
                setConsent(false);
              }}
            >
              {(["read", "gated", "autonomous"] as const).map((p) => (
                <RadioCard
                  key={p}
                  value={p}
                  title={PRESET_LABEL[p]}
                  description={PRESET_DESCRIPTION[p]}
                  tone={p === "autonomous" ? "danger" : "default"}
                  badge={p === "gated" ? <Badge variant="brand">empfohlen</Badge> : undefined}
                  disabledReason={presetDisabledReason(p, draft.provider) ?? undefined}
                />
              ))}
            </RadioGroup>
            {!preset ? <p className="text-ui text-muted-foreground">Eigene Einstellungen (siehe Erweitert).</p> : null}
            {gateOk && !sandboxOk && preset === "gated" ? <p className="text-ui text-muted-foreground">Sandbox nur mit Claude Code.</p> : null}
            {consentNeeded ? (
              <div className="space-y-2">
                <Callout variant="danger">Der Agent ändert Dateien und führt Befehle ohne Rückfrage aus.</Callout>
                <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-ui">
                  <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                  Ich weiß, dass Befehle ohne Rückfrage laufen.
                </label>
              </div>
            ) : null}
          </section>

          {/* 5. Erweitert */}
          <section className="rounded-lg border border-border">
            <button
              type="button"
              aria-expanded={advanced}
              aria-controls="ns-advanced"
              onClick={() => setAdvanced((v) => !v)}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-semibold hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring md:min-h-10 md:text-ui"
            >
              <ChevronRight aria-hidden className={cn("size-4 text-subtle-foreground transition-transform", advanced && "rotate-90")} />
              Erweitert
              <span className="ml-auto truncate font-normal text-subtle-foreground">{approvalModeLabel(gateOk ? draft.approvalMode : "off")}</span>
            </button>
            {advanced ? (
              <div id="ns-advanced" className="space-y-4 border-t border-border p-3">
                <div className="space-y-1.5">
                  <span id="ns-tools" className="text-ui font-medium">
                    Werkzeuge
                  </span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="ns-tools">
                    {chips.map((c) => (
                      <ToggleChip
                        key={c.key}
                        pressed={chipPressed(c, draft.allowedTools)}
                        onPressedChange={(on) => setDraft((prev) => ({ ...prev, allowedTools: toggleChip(prev.allowedTools, c, on) }))}
                        title={c.rules.join(", ")}
                      >
                        {c.label}
                      </ToggleChip>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Nur erlaubte Werkzeuge werden ausgeführt.</p>
                  {rulesHint ? <p className="text-xs text-muted-foreground">{rulesHint}</p> : null}
                  {isPi ? (
                    <p className="text-xs text-muted-foreground">
                      pi: Git, GitHub CLI, Websuche und Web abrufen haben keine Wirkung (für git/gh „Befehl“ aktivieren). Vom Berechtigungsmodus
                      wirkt nur „Nur planen“.
                    </p>
                  ) : null}
                </div>
                <Field>
                  <FieldLabel>Freigabe</FieldLabel>
                  <SimpleSelect
                    value={gateOk ? draft.approvalMode : "off"}
                    disabled={!gateOk}
                    onValueChange={(v) => setDraft({ ...draft, approvalMode: v as ApprovalMode })}
                    options={(["off", "edits", "all"] as const).map((m) => ({ value: m, label: approvalModeLabel(m) }))}
                  />
                  {!gateOk ? <FieldHint>Freigabe-Gate nur mit Claude Code oder pi.</FieldHint> : null}
                </Field>
                <SwitchRow
                  label="Sandbox"
                  description={sandboxOk ? "Schreibzugriff auf den Projektordner begrenzen." : "Sandbox nur mit Claude Code."}
                  checked={sandboxOk && draft.sandbox}
                  disabled={!sandboxOk}
                  onCheckedChange={(v) => setDraft({ ...draft, sandbox: v })}
                />
                <Field>
                  <FieldLabel>Berechtigungsmodus</FieldLabel>
                  <SimpleSelect
                    value={draft.permissionMode}
                    onValueChange={(v) => setDraft({ ...draft, permissionMode: v })}
                    options={modes.map((m) => ({ value: m, label: permissionModeLabel(m) }))}
                  />
                </Field>
                {warning ? <Callout variant="warning">{warning}</Callout> : null}
              </div>
            ) : warning && !consentNeeded ? (
              <div className="border-t border-border p-3">
                <Callout variant="warning">{warning}</Callout>
              </div>
            ) : null}
          </section>
        </SheetBody>
        <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 truncate text-ui text-muted-foreground sm:flex-1" aria-live="polite">
            {draftSummary(cwd ? folderName(cwd) : "", draft)}
          </p>
          <Button variant="primary" size="lg" className="shrink-0" onClick={() => void create()} loading={creating} disabledReason={startReason}>
            {action.kind === "open" ? <ArrowRight aria-hidden /> : action.kind === "resume" ? <History aria-hidden /> : <Rocket aria-hidden />}
            {startLabel(action)}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Compact radio tile for the agent choice (wraps on narrow sheets). */
function RadioGroupTile({ value, label }: { value: string; label: string }) {
  return (
    <RadioCard
      value={value}
      title={
        <span className="inline-flex items-center gap-1.5">
          <ProviderDot tone={providerTone(value)} />
          {label}
        </span>
      }
      className="min-h-11 items-center gap-2 p-2 md:min-h-10"
    />
  );
}
