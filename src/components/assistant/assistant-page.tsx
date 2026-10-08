"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { EMPTY_ORCHESTRA_LIVE } from "@/components/orchestra";
import { ActivityAppBarChip, OfflineAppBarChip, sessionHref } from "@/components/layout/activity";
import { openCommandPalette } from "@/components/layout/shell-state";
import { AppBar } from "@/components/ui/app-bar";
import { Button, IconButton } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/components/ui/status-badge";
import { useActivity } from "@/hooks/use-activity";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { MOBILE_QUERY, useIsMobile, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useShellChrome } from "@/hooks/use-shell-chrome";
import { getApiKey } from "@/lib/ai/client-keys";
import { gatherClientProviders } from "@/lib/client-providers";
import { formatRelative } from "@/lib/format";
import type { OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import {
  COMPOSER_DRAFT_PREFIX,
  EMPTY_PROJECT_CONTEXT,
  PLAN_APPROVAL_KEY,
  buildPreference,
  loopBody,
  type ComposerMode,
  type ProjectContext,
} from "./composer-logic";
import type { ComposerProps } from "./composer";
import { useDevServer } from "./dev-server-panel";
import { Inspector, type InspectorTab } from "./inspector";
import { metaOf } from "./meta";
import { NewSessionSheet } from "./new-session-sheet";
import { OrchestraPlanCard, type PlanDraft } from "./plan-card";
import { PLAN_REJECT_REASON, SKIP_QUESTION_REASON } from "./question-logic";
import { pendingCards } from "./run-events";
import { SessionPane } from "./session-pane";
import { folderName, neighbourSession } from "./session-list";
import { ThreadPane } from "./thread-pane";
import { buildThread, latestLoop, threadRows } from "./thread-model";
import { touchedFiles, type TouchedFile } from "./tool-calls";
import { useActiveRunState } from "./use-run-state";
import { storedSessionId, useSessionRun } from "./use-session-run";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions, type PlannedSubtask, type SessionSummary } from "./types";

const LIST_COLLAPSED_KEY = "cm-assistant-list-collapsed";
const WIDE_QUERY = "(min-width: 1280px)";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/** Mobile list screen: own AppBar with [+] (the shell's has no slot for it). */
function MobileListChrome({ onNew }: { onNew: () => void }) {
  useShellChrome({ appBar: false });
  return (
    <AppBar
      className="md:hidden"
      title="Assistent"
      titleAs="h1"
      actions={
        <>
          <OfflineAppBarChip />
          <ActivityAppBarChip />
          <IconButton aria-label="Neue Session" onClick={onNew}>
            <Plus />
          </IconButton>
          <IconButton aria-label="Suchen & springen" aria-haspopup="dialog" onClick={() => openCommandPalette()}>
            <Search />
          </IconButton>
        </>
      }
    />
  );
}

/** Thread screen while the session loads (the shell's bars stay hidden). */
function MobileThreadLoading() {
  useShellChrome({ appBar: false, tabBar: false });
  return (
    <>
      <AppBar back={{ href: "/assistant", label: "Sessions" }} title="Session wird geladen …" titleAs="h1" />
      <div className="space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-24 w-11/12 rounded-lg" />
        <Skeleton className="h-10 w-2/3 rounded-lg" />
      </div>
    </>
  );
}

/** /assistant (DESIGN.md §6.2): session list, thread, inspector, new-session sheet. */
export function AssistantPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const wide = useMediaQuery(WIDE_QUERY);
  const sessionParam = useSearchParams().get("session");

  // --- Sessions list -------------------------------------------------------------
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false);
  const loadSessions = React.useCallback(() => {
    fetch("/api/assistant/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setSessions(Array.isArray(d.sessions) ? d.sessions : []);
        setSessionsLoaded(true);
      })
      .catch(() => {});
  }, []);

  const {
    activeId,
    info,
    messages,
    live,
    running,
    stopping,
    connection,
    openSession,
    ensureSession,
    reattach,
    closeSession,
    startRun,
    stop,
    decide,
  } = useSessionRun(loadSessions);
  const activeRef = React.useRef(activeId);
  React.useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  const activity = useActivity();
  const now = useNow(running || activity.counts.running > 0 ? 1000 : 30_000);

  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Keep the list fresh: fast while anything runs, slow otherwise — that also
  // picks up runs started elsewhere (Telegram).
  const anyRunning = sessions.some((s) => s.status === "running") || activity.counts.running > 0;
  React.useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadSessions();
    }, anyRunning ? 4000 : 20000);
    return () => clearInterval(t);
  }, [anyRunning, loadSessions]);

  // --- URL ↔ session ------------------------------------------------------------
  // ?session= (push and Telegram deep links) opens that session. Without it,
  // desktop restores the last session; the phone shows the list. The hook
  // writes ?session= itself, so the live URL is read (a lagging render must
  // not switch back).
  const restoredRef = React.useRef(false);
  React.useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("session");
    const phone = window.matchMedia(MOBILE_QUERY).matches;
    if (!restoredRef.current) {
      restoredRef.current = true;
      if (!fromUrl) {
        const stored = storedSessionId();
        // A remembered session may have been deleted meanwhile — drop it silently.
        if (stored && !phone) ensureSession(stored, { quiet: true });
        return;
      }
    }
    if (fromUrl) ensureSession(fromUrl);
    else if (phone && activeRef.current) {
      // Back from the thread screen to the list.
      closeSession(activeRef.current, { keepStored: true });
    }
  }, [sessionParam, ensureSession, closeSession]);

  /** Opens a session: in place on desktop, as a new screen (history entry) on the phone. */
  const goToSession = React.useCallback(
    (id: string) => {
      if (window.matchMedia(MOBILE_QUERY).matches) router.push(sessionHref(id));
      else void openSession(id);
    },
    [router, openSession],
  );

  // The active session runs (started in another tab / via Telegram) but this
  // page is not attached — attach.
  const activeSummary = sessions.find((s) => s.id === activeId);
  const activeStatus = activeSummary?.status;
  React.useEffect(() => {
    if (activeStatus === "running" && !running) reattach();
  }, [activeStatus, running, reattach]);

  // --- Composer state -------------------------------------------------------------
  const [input, setInput] = React.useState("");
  const [mode, setMode] = React.useState<ComposerMode>("chat");
  const [useKnowledge, setUseKnowledge] = React.useState(true);
  const [loopOpts, setLoopOpts] = React.useState<LoopOptions>(DEFAULT_LOOP_OPTIONS);
  const [planApproval, setPlanApprovalState] = React.useState(false);
  const [conductor, setConductor] = React.useState("");
  const [projectContext, setProjectContext] = React.useState<ProjectContext>(EMPTY_PROJECT_CONTEXT);
  const [planDraft, setPlanDraft] = React.useState<PlanDraft | null>(null);
  const [planning, setPlanning] = React.useState(false);
  React.useEffect(() => setPlanApprovalState(readFlag(PLAN_APPROVAL_KEY, false)), []);
  const setPlanApproval = (v: boolean) => {
    setPlanApprovalState(v);
    writeFlag(PLAN_APPROVAL_KEY, v);
  };

  // --- Sheets and panes -----------------------------------------------------------
  const [newOpen, setNewOpen] = React.useState(false);
  const [newCwd, setNewCwd] = React.useState<string | null>(null);
  const [handoffTitle, setHandoffTitle] = React.useState<string | undefined>(undefined);
  const [listCollapsed, setListCollapsed] = React.useState(false);
  React.useEffect(() => setListCollapsed(readFlag(LIST_COLLAPSED_KEY, false)), []);
  const toggleList = React.useCallback(() => {
    setListCollapsed((v) => {
      writeFlag(LIST_COLLAPSED_KEY, !v);
      return !v;
    });
  }, []);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [inspectorTab, setInspectorTab] = React.useState<InspectorTab>("run");
  const openInspector = React.useCallback((tab: InspectorTab) => {
    setInspectorTab(tab);
    setInspectorOpen(true);
  }, []);

  const openNew = React.useCallback((cwd?: string | null) => {
    setNewCwd(cwd ?? null);
    setNewOpen(true);
  }, []);

  // --- Handoffs (Builder/Library → Assistant) and ?new=1 ---------------------------
  React.useEffect(() => {
    const url = new URL(window.location.href);
    let opened = false;
    // Legacy handoff: prompt (+ "loop") from the Builder / Library.
    let prompt: string | null = null;
    let handoffMode: string | null = null;
    try {
      prompt = sessionStorage.getItem("pb-assistant-prompt");
      handoffMode = sessionStorage.getItem("pb-assistant-mode");
      sessionStorage.removeItem("pb-assistant-prompt");
      sessionStorage.removeItem("pb-assistant-mode");
    } catch {
      /* storage unavailable */
    }
    if (prompt) {
      setInput(prompt);
      if (handoffMode === "loop") setMode("loop");
      toast.info("Prompt übernommen – wähle oder starte eine Session und sende ihn ab.");
    }
    // ?new=1[&cwd=…][&handoff=1]
    if (url.searchParams.get("new") === "1") {
      if (url.searchParams.get("handoff") === "1") {
        try {
          const raw = sessionStorage.getItem("cm-assistant-handoff");
          sessionStorage.removeItem("cm-assistant-handoff");
          const d = raw ? (JSON.parse(raw) as { prompt?: unknown; title?: unknown }) : null;
          if (d && typeof d.prompt === "string" && d.prompt.trim()) {
            setInput(d.prompt);
            if (typeof d.title === "string" && d.title.trim()) setHandoffTitle(d.title.trim());
          }
        } catch {
          /* malformed handoff */
        }
      }
      openNew(url.searchParams.get("cwd"));
      opened = true;
      for (const k of ["new", "cwd", "handoff"]) url.searchParams.delete(k);
      window.history.replaceState(null, "", url);
    }
    // A handed-over prompt without a session to send it in: start one.
    if (prompt && !opened && (window.matchMedia(MOBILE_QUERY).matches || !storedSessionId())) openNew(null);
  }, [openNew]);

  // --- Drafts survive the update reload (§6.10) ------------------------------------
  const inputRef = React.useRef(input);
  React.useEffect(() => {
    inputRef.current = input;
  }, [input]);
  React.useEffect(() => {
    const save = () => {
      const text = inputRef.current;
      if (!text.trim()) return;
      try {
        sessionStorage.setItem(`${COMPOSER_DRAFT_PREFIX}${activeRef.current ?? "new"}`, text);
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener("cm:before-update-reload", save);
    return () => window.removeEventListener("cm:before-update-reload", save);
  }, []);
  React.useEffect(() => {
    const key = `${COMPOSER_DRAFT_PREFIX}${activeId ?? "new"}`;
    try {
      const draft = sessionStorage.getItem(key);
      if (draft === null) return;
      sessionStorage.removeItem(key);
      setInput((cur) => (cur.trim() ? cur : draft));
      toast.info("Ungespeicherte Nachricht wiederhergestellt");
    } catch {
      /* storage unavailable */
    }
  }, [activeId]);

  // --- Derived thread ---------------------------------------------------------------
  const rows = React.useMemo(() => threadRows(messages, live.items, running), [messages, live.items, running]);
  const gates = React.useMemo(
    () => [
      ...live.receipts.map((r) => ({ approvalId: r.approvalId, pos: r.card.pos })),
      ...pendingCards(live).map((c) => ({ approvalId: c.approvalId, pos: c.pos })),
    ],
    [live],
  );
  const blocks = React.useMemo(() => buildThread(rows, { cwd: info?.cwd, gates }), [rows, info?.cwd, gates]);
  const pending = React.useMemo(() => pendingCards(live), [live]);
  const loopTimeline = React.useMemo(() => latestLoop(rows), [rows]);
  const files = React.useMemo(() => touchedFiles(rows, info?.cwd), [rows, info?.cwd]);

  const runState = useActiveRunState({
    live,
    running,
    stopping,
    connection,
    sessionStatus: info?.status,
    reachable: activity.reachable,
    now,
  });

  const orch = React.useMemo(() => {
    if (planDraft && planDraft.sid === activeId && !running) {
      return {
        ...EMPTY_ORCHESTRA_LIVE,
        phase: "awaiting_approval" as const,
        subtasks: planDraft.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          status: "waiting" as const,
          roleId: s.roleId,
          workerId: s.workerId,
          dependsOn: s.dependsOn,
          editsFiles: s.editsFiles,
        })),
        roles: planDraft.roles.map((r) => ({ id: r.id, name: r.name, editsFiles: !!r.editsFiles })),
      };
    }
    return live.orch;
  }, [planDraft, activeId, running, live.orch]);
  const showOrchestra = orch !== EMPTY_ORCHESTRA_LIVE || blocks.some((b) => b.kind === "plan");

  const dev = useDevServer(activeId);

  // --- Actions ----------------------------------------------------------------------
  const activePlan = planDraft && planDraft.sid === activeId ? planDraft : null;
  const busy = running || planning;

  async function orchestrate(prompt: string, sid: string) {
    const preference = buildPreference(projectContext) || undefined;
    const planner = conductor ? { plannerWorkerId: conductor } : {};
    const clientProviders = await gatherClientProviders();
    if (planApproval) {
      // Planning is synchronous; the plan is reviewed before anything runs.
      setPlanning(true);
      try {
        const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(sid)}/orchestrate/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, preference, clientProviders, ...planner }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(d.error || "Planung fehlgeschlagen.");
          setInput((cur) => cur || prompt);
          if (res.status === 409) reattach();
          return;
        }
        setPlanDraft({
          sid,
          prompt,
          workers: Array.isArray(d.workers) ? (d.workers as OrchestraWorkerInfo[]) : [],
          subtasks: Array.isArray(d.subtasks) ? (d.subtasks as PlannedSubtask[]) : [],
          roles: Array.isArray(d.roles) ? d.roles : [],
        });
      } catch {
        toast.error("Planung fehlgeschlagen.");
        setInput((cur) => cur || prompt);
      } finally {
        setPlanning(false);
      }
      return;
    }
    const r = await startRun(sid, "orchestrate", { prompt, preference, clientProviders, ...planner }, prompt);
    if (!r.ok) setInput((cur) => cur || prompt);
  }

  async function send() {
    if (!activeId || busy) return;
    const prompt = input;
    if (!prompt.trim()) return;
    // Bound to the session the prompt was typed in; startRun refuses if the
    // user switched sessions while the key was being read.
    const sid = activeId;
    setInput("");
    if (mode === "orchestrate") {
      await orchestrate(prompt, sid);
      return;
    }
    const apiKey = info?.provider === "gemini" ? await getApiKey("gemini") : undefined;
    const r =
      mode === "loop"
        ? await startRun(sid, "loop", { prompt, apiKey, useKnowledge, ...loopBody(loopOpts) }, prompt)
        : await startRun(sid, "message", { prompt, apiKey, useKnowledge }, prompt);
    if (!r.ok) setInput((cur) => cur || prompt);
  }

  async function runEditedPlan() {
    const plan = activePlan;
    if (!plan || busy) return;
    setPlanDraft(null);
    const clientProviders = await gatherClientProviders();
    const r = await startRun(
      plan.sid,
      "orchestrate/run",
      { prompt: plan.prompt, subtasks: plan.subtasks, clientProviders, ...(conductor ? { plannerWorkerId: conductor } : {}) },
      plan.prompt,
    );
    // Keep the edited plan for a retry unless the session is busy elsewhere.
    if (!r.ok && r.status !== 409) setPlanDraft(plan);
  }

  function cancelPlan() {
    const plan = activePlan;
    setPlanDraft(null);
    if (plan) setInput((cur) => cur || plan.prompt);
  }

  /** „Erneut ausführen": re-sends the last prompt the way it ran. */
  async function retry() {
    if (!activeId || busy) return;
    const all = rows.map((r) => r.msg);
    const idx = all.map((m) => m.role).lastIndexOf("user");
    if (idx < 0) return;
    const last = all[idx];
    const meta = metaOf(last);
    const prompt = last.content.replace(/^🔁\s*Loop:\s*/, "");
    const sid = activeId;
    const apiKey = info?.provider === "gemini" ? await getApiKey("gemini") : undefined;
    if (meta.loop && typeof meta.loop === "object") {
      const l = meta.loop as Partial<LoopOptions> & { useKnowledge?: boolean };
      const opts = loopBody({ ...DEFAULT_LOOP_OPTIONS, ...l });
      await startRun(sid, "loop", { prompt, apiKey, useKnowledge: l.useKnowledge ?? useKnowledge, ...opts }, last.content);
      return;
    }
    if (all.slice(idx + 1).some((m) => m.role === "plan")) {
      await orchestrate(prompt, sid);
      return;
    }
    await startRun(sid, "message", { prompt, apiKey, useKnowledge }, prompt);
  }

  const stopFor = React.useCallback(
    async (sid: string, kind: string | undefined) => {
      if (kind === "loop" || kind === "orchestrate") {
        const ok = await confirm({
          title: "Lauf stoppen?",
          description: "Die aktuelle Iteration wird abgebrochen. Bereits geänderte Dateien bleiben.",
          confirmLabel: "Stoppen",
          tone: "danger",
        });
        if (!ok) return;
      }
      await stop(sid);
      toast.info("Lauf wird gestoppt.");
    },
    [stop],
  );

  const stopActive = () => {
    if (activeId && (running || stopping)) void stopFor(activeId, live.run?.kind);
  };

  const deleteSession = React.useCallback(
    async (s: SessionSummary | { id: string; title?: string }) => {
      const ok = await confirm({
        title: "Session löschen?",
        description: "Verlauf und Anhänge werden entfernt. Laufende Läufe werden gestoppt. Dateien im Projektordner bleiben unverändert.",
        confirmLabel: "Löschen",
        tone: "danger",
      });
      if (!ok) return;
      const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(s.id)}`, { method: "DELETE" }).catch(() => null);
      // 404: already gone (another tab) — treat as deleted.
      if (!res || (!res.ok && res.status !== 404)) {
        const d = res ? await res.json().catch(() => ({})) : {};
        toast.error(d.error || (res ? "Session konnte nicht gelöscht werden." : "Server nicht erreichbar."));
        return;
      }
      const wasActive = activeRef.current === s.id;
      closeSession(s.id); // no-op unless it is (still) the open session
      loadSessions();
      toast.success("Session gelöscht.");
      if (wasActive && window.matchMedia(MOBILE_QUERY).matches) router.push("/assistant");
    },
    [closeSession, loadSessions, router],
  );

  async function denyAll() {
    const cards = pendingCards(live);
    if (!cards.length) return;
    const ok = await confirm({
      title: "Alle ablehnen?",
      description: cards.length === 1 ? "Die offene Freigabe wird abgelehnt." : `${cards.length} offene Freigaben und Fragen werden abgelehnt.`,
      confirmLabel: "Alle ablehnen",
      tone: "danger",
    });
    if (!ok) return;
    for (const c of cards) {
      if (c.type === "question_request") void decide(c, "deny", c.kind === "plan" ? PLAN_REJECT_REASON : SKIP_QUESTION_REASON);
      else void decide(c, "deny");
    }
  }

  const onFile = (f: TouchedFile) => {
    setInspectorOpen(false);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-tool-keys~="${CSS.escape(f.lastKey)}"]`);
      el?.scrollIntoView({ block: "center" });
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  };
  const onSelectSubtask = (id: string) => {
    setInspectorOpen(false);
    requestAnimationFrame(() => {
      const all = document.querySelectorAll<HTMLElement>(`[data-subtask-id="${CSS.escape(id)}"]`);
      const el = all[all.length - 1];
      el?.scrollIntoView({ block: "start" });
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  };

  // --- Shortcuts (§5.6) -------------------------------------------------------------
  const orderRef = React.useRef<string[]>([]);
  const onOrder = React.useCallback((ids: string[]) => {
    orderRef.current = ids;
  }, []);
  useHotkeys(
    {
      n: () => openNew(null),
      j: () => {
        const id = neighbourSession(orderRef.current, activeRef.current, 1);
        if (id) goToSession(id);
      },
      k: () => {
        const id = neighbourSession(orderRef.current, activeRef.current, -1);
        if (id) goToSession(id);
      },
      "mod+\\": () => !isMobile && toggleList(),
      // German keyboards: \ needs AltGr/⌥ — Strg+ß is the same key.
      "mod+ß": () => !isMobile && toggleList(),
      "mod+.": () => stopActive(),
    },
    { allowInInputs: ["mod+.", "mod+\\", "mod+ß"] },
  );

  // --- Composer props ---------------------------------------------------------------
  // While a run goes, the mode chip shows how it runs (also for runs started
  // elsewhere); the chip is locked until the run ends.
  const runMode: ComposerMode | null = running && live.run ? (live.run.kind === "turn" ? "chat" : live.run.kind) : null;
  const runLoop: LoopOptions | null =
    runMode === "loop" && loopTimeline?.settings
      ? {
          maxIterations: loopTimeline.settings.maxIterations ?? loopTimeline.max ?? DEFAULT_LOOP_OPTIONS.maxIterations,
          completionPromise: loopTimeline.settings.completionPromise ?? DEFAULT_LOOP_OPTIONS.completionPromise,
          intervalSec: loopTimeline.settings.intervalSec ?? 0,
          freshContext: loopTimeline.settings.freshContext ?? false,
          stopOnError: loopTimeline.settings.stopOnError ?? true,
        }
      : null;
  const composer: ComposerProps = {
    value: input,
    onChange: setInput,
    onSend: () => void send(),
    useKnowledge,
    onUseKnowledge: setUseKnowledge,
    sessionId: activeId,
    running,
    busy: planning,
    offline: !runState.online,
    mode: runMode ?? mode,
    onModeChange: setMode,
    loop: runLoop ?? loopOpts,
    onLoopChange: setLoopOpts,
    planApproval,
    onPlanApproval: setPlanApproval,
    conductor,
    onConductor: setConductor,
    context: projectContext,
    onContext: setProjectContext,
  };

  const loopSignal =
    live.run?.kind === "loop" ? (loopTimeline?.settings?.completionPromise ?? undefined) : undefined;
  const activeLoopLabel = live.loop ? `Loop ${live.loop.iteration}/${live.loop.maxIterations}` : null;

  const newSheet = (
    <NewSessionSheet
      open={newOpen}
      onOpenChange={(o) => {
        setNewOpen(o);
        if (!o) setHandoffTitle(undefined);
      }}
      sessions={sessions}
      initialCwd={newCwd}
      title={handoffTitle}
      onCreated={(id) => {
        loadSessions();
        setHandoffTitle(undefined);
        goToSession(id);
      }}
    />
  );

  const inspectorProps = {
    tab: inspectorTab,
    onTab: setInspectorTab,
    info,
    state: runState.state,
    run: running ? live.run : null,
    loop: loopTimeline,
    orch,
    showOrchestra,
    files,
    onFile,
    onSelectSubtask,
    dev,
    now,
  };

  const planCard = activePlan ? (
    <OrchestraPlanCard
      plan={activePlan}
      busy={busy}
      onChange={(subtasks) => setPlanDraft((prev) => (prev ? { ...prev, subtasks } : prev))}
      onRun={() => void runEditedPlan()}
      onCancel={cancelPlan}
    />
  ) : null;

  const threadPane = activeId ? (
    <ThreadPane
      variant={isMobile ? "mobile" : "desktop"}
      sessionId={activeId}
      title={info?.title || activeSummary?.title || (info ? folderName(info.cwd) : "Session")}
      info={info}
      run={runState}
      live={live}
      running={running}
      stopping={stopping}
      connection={connection}
      blocks={blocks}
      pending={pending}
      receipts={live.receipts}
      orch={orch}
      loopSignal={loopSignal}
      planning={planning}
      planCard={planCard}
      now={now}
      composer={composer}
      decide={decide}
      onStop={stopActive}
      onDenyAll={() => void denyAll()}
      onDelete={() => void deleteSession({ id: activeId })}
      onInspector={isMobile || !wide ? openInspector : undefined}
      listCollapsed={!isMobile && listCollapsed}
      onExpandList={toggleList}
      onRetry={() => void retry()}
      onRecheck={() => reattach(true)}
    />
  ) : null;

  const inspectorSheet = (
    <Sheet open={inspectorOpen && (isMobile || !wide)} onOpenChange={setInspectorOpen}>
      <SheetContent side="auto" className="md:max-w-[380px]" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>Details</SheetTitle>
        </SheetHeader>
        <Inspector {...inspectorProps} className="flex min-h-0 flex-1 flex-col" />
      </SheetContent>
    </Sheet>
  );

  // --- Phone --------------------------------------------------------------------------
  if (isMobile) {
    if (sessionParam) {
      return (
        <div className="flex min-h-0 flex-1 flex-col bg-background">
          {threadPane ?? <MobileThreadLoading />}
          {inspectorSheet}
          {newSheet}
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <MobileListChrome onNew={() => openNew(null)} />
        <SessionPane
          variant="mobile"
          className="flex-1"
          sessions={sessions}
          loaded={sessionsLoaded}
          activeId={null}
          activeState="idle"
          activeLoopLabel={null}
          runs={activity.runs}
          pending={activity.pending}
          now={now}
          onNew={() => openNew(null)}
          onStop={(s) => void stopFor(s.id, activity.runs.find((r) => r.sessionId === s.id)?.kind)}
          onDelete={(s) => void deleteSession(s)}
          onOrder={onOrder}
        />
        {newSheet}
      </div>
    );
  }

  // --- Desktop ------------------------------------------------------------------------
  const recent = [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3);
  return (
    <div className="flex min-h-0 flex-1 bg-background">
      {!listCollapsed ? (
        <SessionPane
          variant="desktop"
          className="w-[276px] shrink-0 border-r border-border bg-surface"
          sessions={sessions}
          loaded={sessionsLoaded}
          activeId={activeId}
          activeState={runState.state}
          activeLoopLabel={activeLoopLabel}
          runs={activity.runs}
          pending={activity.pending}
          now={now}
          onNew={() => openNew(null)}
          onOpen={goToSession}
          onStop={(s) =>
            void stopFor(s.id, s.id === activeId ? live.run?.kind : activity.runs.find((r) => r.sessionId === s.id)?.kind)
          }
          onDelete={(s) => void deleteSession(s)}
          onCollapse={toggleList}
          onOrder={onOrder}
        />
      ) : null}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Session">
        {threadPane ?? (
          <div className="flex min-h-0 flex-1 flex-col">
            {listCollapsed ? (
              <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
                <Button variant="ghost" size="sm" onClick={toggleList}>
                  Sessionliste einblenden
                </Button>
              </div>
            ) : null}
            <h1 className="sr-only">Assistent</h1>
            <EmptyState
              className="my-auto"
              icon={<SquareTerminal />}
              title={sessionsLoaded && sessions.length === 0 ? "Noch keine Session" : "Wähle eine Session oder starte eine neue."}
              description={sessionsLoaded && sessions.length === 0 ? "Starte einen Agenten in einem Projektordner." : undefined}
              action={
                <Button variant="primary" onClick={() => openNew(null)} kbd="N">
                  <Plus aria-hidden />
                  Neue Session
                </Button>
              }
            >
              {recent.length ? (
                <ul className="mt-6 w-full space-y-1 text-left">
                  {recent.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => goToSession(s.id)}
                        className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-ui hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <StatusIcon state={s.status === "error" ? "error" : s.status === "running" ? "background" : "idle"} />
                        <span className="min-w-0 flex-1 truncate">{s.title || folderName(s.cwd)}</span>
                        <span className="shrink-0 text-xs text-subtle-foreground">{formatRelative(s.updatedAt, now)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : sessionsLoaded && sessions.length === 0 ? (
                <p className="mt-3 text-xs text-subtle-foreground">
                  Tipp: <Kbd>N</Kbd>
                </p>
              ) : null}
            </EmptyState>
          </div>
        )}
      </section>
      {activeId && wide ? (
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-surface" aria-label="Details">
          <Inspector {...inspectorProps} className="flex min-h-0 flex-1 flex-col pt-1" />
        </aside>
      ) : null}
      {inspectorSheet}
      {newSheet}
    </div>
  );
}
