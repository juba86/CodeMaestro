"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { PROVIDERS as CHAT_PROVIDERS } from "@/lib/ai/catalog";
import {
  Plus, Send, Square, Trash2, Loader2, Terminal, FolderGit2, Network, Sparkles, FolderPlus, Folder,
  ChevronUp, ExternalLink, Play, ChevronDown, Maximize2, Minimize2, Paperclip, ShieldCheck, BookOpen,
  Repeat, WifiOff, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { MessageBubble } from "./message-bubble";
import { PendingGates } from "./approval-cards";
import { LoopControls, loopBody } from "./loop-controls";
import { runningLabel } from "./run-events";
import { storedSessionId, useSessionRun } from "./use-session-run";
import { PI_PROVIDER_LABEL, PiInstallHint, SMALL_CONTEXT, formatContext, sortPiModels, usePiStatus } from "./pi-status";
import {
  DEFAULT_LOOP_OPTIONS,
  type BrowseState, type DevStatus, type LoopOptions, type PlannedSubtask, type SessionSummary,
} from "./types";

const PROVIDERS = [
  { id: "claude", label: "Claude Code" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "opencode", label: "OpenCode" },
  { id: "codex", label: "Codex CLI" },
  { id: "aider", label: "Aider" },
  { id: "pi", label: PI_PROVIDER_LABEL },
];

// Approval gate: Claude Code (PreToolUse hook) and pi (tool_call extension).
const APPROVAL_CAPABLE = new Set(["claude", "pi"]);
// The sandbox is Claude Code's own settings feature.
const SANDBOX_CAPABLE = new Set(["claude"]);

type Mode = "chat" | "orchestrate" | "loop";

interface PlanDraft {
  sid: string;
  prompt: string;
  workers: { id: string; label: string; editsFiles?: boolean }[];
  subtasks: PlannedSubtask[];
}

/**
 * Link to the session's dev server. Prefers the server-provided URL (HTTPS via
 * `tailscale serve`); a raw dev port is never TLS, so the fallback is always
 * http — even when this app itself is served over https.
 */
function devHref(dev: DevStatus): string {
  if (dev.url && /^https?:\/\//i.test(dev.url)) return dev.url;
  const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
  return `http://${host}:${dev.port}`;
}

// Collect the user's configured cloud/custom OpenAI-compatible providers so the
// orchestrator can offer them as optional text workers (keys live in the
// browser). Cloud needs a key; the custom endpoint needs a base URL.
async function gatherClientProviders(): Promise<{ id: string; key: string; baseUrl: string }[]> {
  const out: { id: string; key: string; baseUrl: string }[] = [];
  for (const def of CHAT_PROVIDERS) {
    if (def.kind !== "openai" && def.kind !== "openai-local") continue;
    const key = await getApiKey(def.id);
    const baseUrl = getBaseUrl(def.id);
    if (def.kind === "openai") { if (!key) continue; } // cloud: needs key
    else if (def.configurableBaseUrl) { if (!baseUrl) continue; } // custom: needs base
    else continue; // lmstudio etc.: skip auto-include to avoid inert workers
    out.push({ id: def.id, key, baseUrl });
  }
  return out;
}

export function AssistantView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  const loadSessions = useCallback(() => {
    fetch("/api/assistant/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setSessions(d.sessions || []); setSessionsLoaded(true); })
      .catch(() => {});
  }, []);

  const {
    activeId, messages, live, running, stopping, reconnecting,
    openSession, ensureSession, reattach, closeSession, startRun, stop, decide,
  } = useSessionRun(loadSessions);

  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  // RAG: augment turns with relevant knowledge-base context (default on; the
  // server no-ops gracefully when the index is empty or Ollama is unreachable).
  const [useKnowledge, setUseKnowledge] = useState(true);
  const [loopOpts, setLoopOpts] = useState<LoopOptions>(DEFAULT_LOOP_OPTIONS);
  const [orchMode, setOrchMode] = useState<"auto" | "hybrid">("auto");
  const [wizardEnabled, setWizardEnabled] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizard, setWizard] = useState({ stack: "", constraints: "", routing: "balanced", verify: false });
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planning, setPlanning] = useState(false);
  // Which model plans/synthesizes the orchestration. "" = Auto (no Claude required).
  const [plannerWorkerId, setPlannerWorkerId] = useState("");
  const [orchWorkers, setOrchWorkers] = useState<{ id: string; label: string }[]>([]);
  const [newFolder, setNewFolder] = useState("");

  const [browse, setBrowse] = useState<BrowseState | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [permissionModes, setPermissionModes] = useState<string[]>([]);

  // Dev-server launcher state, tagged with the session it belongs to.
  const [devState, setDevState] = useState<{ sid: string; status: DevStatus } | null>(null);
  const [devCmd, setDevCmd] = useState("");
  const [devPort, setDevPort] = useState<number>(0);
  const [devLogsOpen, setDevLogsOpen] = useState(false);
  const dev = devState && devState.sid === activeId ? devState.status : null;

  // Mobile/UX: maximize the chat to full screen; collapse the new-session config
  // (open by default only when there is nothing to show yet).
  const [maximized, setMaximized] = useState(false);
  const [configPref, setConfigPref] = useState<boolean | null>(null);
  const configOpen = configPref ?? (sessionsLoaded && sessions.length === 0 && !activeId);

  const [draft, setDraft] = useState({
    provider: "claude",
    model: "",
    cwd: "",
    permissionMode: "default",
    allowedTools: ["Read", "Grep", "Glob"] as string[],
    approvalMode: "off" as "off" | "edits" | "all",
    sandbox: false,
  });

  // pi runs the local AI server's models: pick from the synced list instead of
  // typing an id. Defaults to the first file-editing model; a pick that is no
  // longer synced falls back the same way.
  const isPi = draft.provider === "pi";
  const pi = usePiStatus(isPi && configOpen);
  const piModels = pi.status ? sortPiModels(pi.status.models) : [];
  const piModel = piModels.find((m) => m.id === draft.model) ?? piModels[0] ?? null;
  const piBlocked = isPi && (!pi.status?.installed || !piModel);

  const threadRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only while the user is at the bottom (not while reading back).
  const stickRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeId);
  const busy = running || planning;

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Keep the session list (running badges) fresh: fast while anything runs,
  // slow otherwise — that also picks up runs started elsewhere (Telegram).
  const anyRunning = sessions.some((s) => s.status === "running");
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadSessions();
    }, anyRunning ? 4000 : 20000);
    return () => clearInterval(t);
  }, [anyRunning, loadSessions]);

  // Open the session from the URL (?session=, used by push-notification deep
  // links) or, on first mount, the one used last. The hook itself writes
  // ?session= on every switch, so the value is read from the live URL: a
  // lagging router render must not switch back to the previous session.
  const sessionParam = useSearchParams().get("session");
  const restoredRef = useRef(false);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("session");
    if (!restoredRef.current) {
      restoredRef.current = true;
      if (!fromUrl) {
        const stored = storedSessionId();
        // A remembered session may have been deleted meanwhile — drop it silently.
        if (stored) ensureSession(stored, { quiet: true });
        return;
      }
    }
    if (fromUrl) ensureSession(fromUrl);
  }, [sessionParam, ensureSession]);

  // The active session runs (started in another tab / via Telegram) but this
  // page is not attached — attach.
  const activeStatus = activeSession?.status;
  useEffect(() => {
    if (activeStatus === "running" && !running) reattach();
  }, [activeStatus, running, reattach]);

  // Load the worker pool for the orchestrator's "planner model" dropdown the
  // first time the user enables Orchestrator mode.
  const orchestrateOn = mode === "orchestrate";
  const needWorkers = orchestrateOn && orchWorkers.length === 0;
  useEffect(() => {
    if (!needWorkers) return;
    let cancelled = false;
    (async () => {
      try {
        const clientProviders = await gatherClientProviders();
        const res = await fetch("/api/assistant/orchestrate/workers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientProviders }),
        });
        const d = await res.json();
        if (!cancelled && Array.isArray(d.workers)) setOrchWorkers(d.workers);
      } catch { /* dropdown just falls back to Auto */ }
    })();
    return () => { cancelled = true; };
  }, [needWorkers]);

  // Handoff from the Prompt Builder: a prompt was sent over → prefill the input.
  useEffect(() => {
    const handoff = sessionStorage.getItem("pb-assistant-prompt");
    if (!handoff) return;
    sessionStorage.removeItem("pb-assistant-prompt");
    setInput(handoff);
    setConfigPref(true);
    toast.info("Prompt übernommen — wähle/erstelle eine Session und sende ihn ab.");
  }, []);

  // Folder browser: navigate the allowed directory tree; the browsed folder is
  // the working directory the session will run in.
  const loadBrowse = useCallback(async (path?: string) => {
    const url = path ? `/api/assistant/browse?path=${encodeURIComponent(path)}` : "/api/assistant/browse";
    const d = await fetch(url).then((r) => r.json()).catch(() => null);
    if (d?.path) {
      setBrowse({ path: d.path, parent: d.parent ?? null, dirs: d.dirs || [] });
      setDraft((prev) => ({ ...prev, cwd: d.path }));
    }
  }, []);

  useEffect(() => {
    fetch("/api/assistant/workspaces").then((r) => r.json()).then((d) => {
      setTools(d.tools || []);
      setPermissionModes(d.permissionModes || ["default"]);
    }).catch(() => {});
    void loadBrowse();
  }, [loadBrowse]);

  // New session → start at the bottom again.
  useEffect(() => { stickRef.current = true; }, [activeId]);
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, live.items, busy]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadDev = useCallback(async (sid: string) => {
    const d = (await fetch(`/api/assistant/sessions/${sid}/dev`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)) as DevStatus | null;
    if (!d) return;
    setDevState({ sid, status: d });
    if (d.suggestion) { setDevCmd(d.suggestion.command); setDevPort(d.suggestion.port); }
    else if (d.command && d.port) { setDevCmd(d.command); setDevPort(d.port); }
  }, []);

  useEffect(() => {
    if (activeId) void loadDev(activeId);
  }, [activeId, loadDev]);

  // Poll the dev-server status (logs/exit) while it's running.
  const devRunning = !!dev?.running;
  useEffect(() => {
    if (!activeId || !devRunning) return;
    const t = setInterval(() => void loadDev(activeId), 3000);
    return () => clearInterval(t);
  }, [activeId, devRunning, loadDev]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0 || !activeId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/assistant/sessions/${activeId}/upload`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "Upload fehlgeschlagen."); return; }
      const saved: string[] = Array.isArray(d.saved) ? d.saved : [];
      toast.success(`${saved.length} Datei(en) hochgeladen: ${saved.join(", ")}`);
      if (saved.length) {
        setInput((prev) => prev
          ? prev
          : `Ich habe folgende Dateien ins Projekt hochgeladen: ${saved.join(", ")}. `);
      }
    } catch {
      toast.error("Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function startDevServer() {
    if (!activeId || !devCmd.trim() || !devPort) return;
    const sid = activeId;
    const res = await fetch(`/api/assistant/sessions/${sid}/dev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: devCmd, port: devPort }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "Start fehlgeschlagen."); return; }
    setDevState({ sid, status: d });
    setDevLogsOpen(true);
    toast.success(`App gestartet auf Port ${devPort}.`);
  }

  async function stopDevServer() {
    if (!activeId) return;
    await fetch(`/api/assistant/sessions/${activeId}/dev/stop`, { method: "POST" }).catch(() => {});
    await loadDev(activeId);
    toast.info("App gestoppt.");
  }

  async function createSession() {
    setCreating(true);
    try {
      const res = await fetch("/api/assistant/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          model: isPi ? piModel?.id ?? "" : draft.model,
          // Only Claude Code can sandbox; never store a flag the provider ignores.
          sandbox: SANDBOX_CAPABLE.has(draft.provider) && draft.sandbox,
          allowedTools: draft.allowedTools.join(","),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "Konnte Session nicht anlegen."); return; }
      loadSessions();
      setConfigPref(false);
      await openSession(d.session.id);
      toast.success("Session angelegt.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteSession(sid: string) {
    if (!window.confirm("Session löschen?")) return;
    await fetch(`/api/assistant/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
    closeSession(sid); // no-op unless it is (still) the open session
    loadSessions();
  }

  // Stop a (possibly background) run in any session from the session list.
  async function stopSessionById(sid: string) {
    await stop(sid);
    toast.info("Aufgabe wird gestoppt.");
  }

  async function send() {
    if (!activeId || busy) return;
    if (mode === "orchestrate") { void orchestrate(); return; }
    const prompt = input;
    if (!prompt.trim()) return;
    // Bound to the session the prompt was typed in; startRun refuses if the
    // user switched sessions while the key was being read.
    const sid = activeId;
    setInput("");
    stickRef.current = true;
    const apiKey = activeSession?.provider === "gemini" ? await getApiKey("gemini") : undefined;
    const r = mode === "loop"
      ? await startRun(sid, "loop", { prompt, apiKey, useKnowledge, ...loopBody(loopOpts) }, prompt)
      : await startRun(sid, "message", { prompt, apiKey, useKnowledge }, prompt);
    if (!r.ok) setInput((cur) => cur || prompt);
  }

  function buildPreference(): string {
    if (!wizardEnabled) return "";
    const parts: string[] = [];
    if (wizard.stack.trim()) parts.push(`Stack/Sprache: ${wizard.stack.trim()}.`);
    if (wizard.constraints.trim()) parts.push(`Rahmenbedingungen/No-Gos: ${wizard.constraints.trim()}.`);
    if (wizard.routing === "local") parts.push("Bevorzuge lokale/günstige Modelle, wo die Qualität es zulässt.");
    else if (wizard.routing === "quality") parts.push("Priorisiere beste Qualität; nutze die stärksten Modelle.");
    if (wizard.verify) parts.push("Füge eine abschließende Verifikations-/Test-Teilaufgabe hinzu.");
    return parts.join(" ");
  }

  async function orchestrate() {
    if (!activeId) return;
    if (wizardEnabled && !wizardOpen) {
      setWizardOpen(true);
      return;
    }
    const prompt = input;
    if (!prompt.trim() || busy) return;
    const sid = activeId;
    const preference = buildPreference();
    setInput("");
    setWizardOpen(false);
    stickRef.current = true;

    const clientProviders = await gatherClientProviders();

    if (orchMode === "hybrid") {
      // Planning is synchronous; the plan is reviewed before anything runs.
      setPlanning(true);
      try {
        const res = await fetch(`/api/assistant/sessions/${sid}/orchestrate/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, preference, clientProviders, plannerWorkerId }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(d.error || "Planung fehlgeschlagen.");
          setInput((cur) => cur || prompt);
          if (res.status === 409) reattach();
          return;
        }
        setPlanDraft({ sid, prompt, workers: d.workers || [], subtasks: d.subtasks || [] });
      } catch {
        toast.error("Planung fehlgeschlagen.");
        setInput((cur) => cur || prompt);
      } finally {
        setPlanning(false);
      }
      return;
    }
    const r = await startRun(sid, "orchestrate", { prompt, preference, clientProviders, plannerWorkerId }, prompt);
    if (!r.ok) setInput((cur) => cur || prompt);
  }

  async function runEditedPlan() {
    const plan = planDraft;
    if (!plan || plan.sid !== activeId || busy) return;
    setPlanDraft(null);
    stickRef.current = true;
    const clientProviders = await gatherClientProviders();
    const r = await startRun(
      plan.sid,
      "orchestrate/run",
      { prompt: plan.prompt, subtasks: plan.subtasks, clientProviders, plannerWorkerId },
      plan.prompt,
    );
    // Keep the edited plan for a retry unless the session is busy elsewhere.
    if (!r.ok && r.status !== 409) setPlanDraft(plan);
  }

  function cancelPlan() {
    const plan = planDraft;
    setPlanDraft(null);
    if (plan) setInput((cur) => cur || plan.prompt);
  }

  async function createFolder() {
    if (!newFolder.trim()) return;
    const parent = browse?.path || draft.cwd;
    const res = await fetch("/api/assistant/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolder.trim(), parent }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d.error || "Ordner konnte nicht erstellt werden."); return; }
    setNewFolder("");
    await loadBrowse(d.path); // navigate into the new folder (becomes the cwd)
    toast.success("Ordner erstellt.");
  }

  function toggleTool(t: string) {
    setDraft((prev) => ({
      ...prev,
      allowedTools: prev.allowedTools.includes(t)
        ? prev.allowedTools.filter((x) => x !== t)
        : [...prev.allowedTools, t],
    }));
  }

  const activePlan = planDraft && planDraft.sid === activeId ? planDraft : null;
  const hasCards = live.approvals.length > 0 || live.questions.length > 0;
  const toggleClass = (on: boolean) =>
    `flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border ${
      on ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"
    }`;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_1fr] lg:h-[calc(100vh-7rem)]">
      {/* Sidebar: new session + list — hidden when the chat is maximized */}
      <div className={`flex-col gap-3 lg:overflow-y-auto pr-1 min-w-0 ${maximized ? "hidden" : "flex"}`}>
        <h1 className="text-xl font-bold flex items-center gap-2"><Terminal size={18} /> Code Assistant</h1>

        <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
          <button
            onClick={() => setConfigPref(!configOpen)}
            className="w-full flex items-center justify-between font-medium"
            aria-expanded={configOpen}
          >
            <span className="flex items-center gap-1.5"><Plus size={14} /> Neue Session</span>
            <ChevronDown size={16} className={`transition-transform ${configOpen ? "rotate-180" : ""}`} />
          </button>
          {configOpen && (<>
          <select
            aria-label="Provider"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.provider}
            onChange={(e) => {
              const provider = e.target.value;
              // pi model ids and free-text ids of the other CLIs don't carry over.
              const keepModel = (provider === "pi") === (draft.provider === "pi");
              setDraft({ ...draft, provider, model: keepModel ? draft.model : "" });
            }}
          >
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {/* Folder browser — navigate into any existing project within the allowed roots */}
          <div className="rounded-md border border-input">
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border text-xs">
              <button
                onClick={() => browse?.parent && loadBrowse(browse.parent)}
                disabled={!browse?.parent}
                title="Übergeordneter Ordner"
                aria-label="Übergeordneter Ordner"
                className="p-0.5 rounded hover:bg-accent disabled:opacity-30"
              >
                <ChevronUp size={14} />
              </button>
              <FolderGit2 size={12} className="text-muted-foreground shrink-0" />
              <span className="truncate text-muted-foreground" title={browse?.path}>
                {browse ? browse.path.split("/").slice(-2).join("/") : "…"}
              </span>
            </div>
            <div className="max-h-44 overflow-y-auto p-1">
              {browse && browse.dirs.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">Keine Unterordner</p>
              )}
              {browse?.dirs.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => loadBrowse(dir.path)}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent flex items-center gap-1.5"
                >
                  <Folder size={12} className="text-muted-foreground shrink-0" /> <span className="truncate">{dir.name}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Session startet in: <span className="font-medium text-foreground">{browse?.path.split("/").slice(-1)[0] || "—"}</span>
          </p>
          <div className="flex gap-1.5">
            <input
              className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              placeholder="Neuer Ordner (hier anlegen)"
              aria-label="Name des neuen Ordners"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createFolder(); } }}
            />
            <button
              onClick={createFolder}
              disabled={!newFolder.trim()}
              className="px-2 py-1.5 rounded-md border border-input hover:bg-accent disabled:opacity-50 shrink-0"
              title="Ordner im gewählten Verzeichnis erstellen"
              aria-label="Ordner erstellen"
            >
              <FolderPlus size={14} />
            </button>
          </div>
          {isPi ? (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <select
                  aria-label="Lokales Modell"
                  className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                  value={piModel?.id ?? ""}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  disabled={piModels.length === 0}
                >
                  {piModels.length === 0 && (
                    <option value="">{pi.loading ? "Lade lokale Modelle …" : "Keine lokalen Modelle gefunden"}</option>
                  )}
                  {piModels.some((m) => m.toolsOk) && (
                    <optgroup label="Kann Dateien bearbeiten">
                      {piModels.filter((m) => m.toolsOk).map((m) => (
                        <option key={m.id} value={m.id}>{m.name} · {formatContext(m.contextWindow)}</option>
                      ))}
                    </optgroup>
                  )}
                  {piModels.some((m) => !m.toolsOk) && (
                    <optgroup label="Nur Text (keine Tools)">
                      {piModels.filter((m) => !m.toolsOk).map((m) => (
                        <option key={m.id} value={m.id}>{m.name} · {formatContext(m.contextWindow)} — nur Text</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  onClick={() => void pi.refresh(true)}
                  disabled={pi.loading}
                  className="px-2 py-1.5 rounded-md border border-input hover:bg-accent disabled:opacity-50 shrink-0"
                  title="Modelle vom KI-Server neu synchronisieren"
                  aria-label="Lokale Modelle neu synchronisieren"
                >
                  {pi.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
              </div>
              {pi.error && <p className="text-[11px] text-red-500">{pi.error}</p>}
              {pi.status && !pi.status.installed && <PiInstallHint hint={pi.status.installHint} compact />}
              {pi.status?.error && <p className="text-[11px] text-amber-500">{pi.status.error}</p>}
              {piModel && (
                <p className="text-[11px] text-muted-foreground">
                  {piModel.toolsOk
                    ? "Kann Dateien bearbeiten"
                    : <span className="text-amber-500">Ohne Tool-Unterstützung — antwortet nur in Text, keine Datei-Edits</span>}
                  {piModel.reasoning && " · Thinking"}
                  {piModel.vision && " · Vision"}
                  {" · "}
                  <span className={piModel.contextWindow > 0 && piModel.contextWindow < SMALL_CONTEXT ? "text-amber-500" : undefined}>
                    Kontext {formatContext(piModel.contextWindow)}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              placeholder="Modell (optional, z.B. opus / sonnet)"
              aria-label="Modell"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          )}
          <select
            aria-label="Permission-Mode"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.permissionMode}
            onChange={(e) => setDraft({ ...draft, permissionMode: e.target.value })}
          >
            {permissionModes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <button
                key={t}
                onClick={() => toggleTool(t)}
                aria-pressed={draft.allowedTools.includes(t)}
                className={`px-2 py-0.5 text-xs rounded border ${
                  draft.allowedTools.includes(t)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input hover:bg-accent"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Nur erlaubte Tools werden ausgeführt. Edit/Write/Bash nur aktivieren, wenn der Assistent Dateien ändern / Befehle ausführen soll.
          </p>
          {isPi && (
            <p className="text-[11px] text-muted-foreground">
              pi: Bash(git *), Bash(gh *), WebSearch und WebFetch haben keine Wirkung (für git/gh „Bash“ aktivieren). Vom Permission-Mode wirkt nur „plan“ (nur lesende Tools).
            </p>
          )}
          {APPROVAL_CAPABLE.has(draft.provider) ? (
          <div className="space-y-1.5 rounded-md border border-border p-2">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck size={13} /> Freigabe vor Aktionen
            </label>
            <select
              aria-label="Freigabe-Modus"
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.approvalMode}
              onChange={(e) => setDraft({ ...draft, approvalMode: e.target.value as "off" | "edits" | "all" })}
            >
              <option value="off">Aus — direkt ausführen</option>
              <option value="edits">Datei-Änderungen bestätigen (Diff)</option>
              <option value="all">Änderungen + Befehle bestätigen</option>
            </select>
            {SANDBOX_CAPABLE.has(draft.provider) ? (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.sandbox}
                  onChange={(e) => setDraft({ ...draft, sandbox: e.target.checked })}
                />
                Sandbox (Schreibzugriff auf Projekt begrenzen)
              </label>
            ) : (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-not-allowed">
                <input type="checkbox" checked={false} disabled readOnly />
                Sandbox nur mit Claude Code
              </label>
            )}
            <p className="text-[11px] text-muted-foreground">
              Bei aktivierter Freigabe zeigt der Assistent vor jedem Edit/Write{draft.approvalMode === "all" ? "/Bash" : ""} einen Diff bzw. Befehl, den du freigeben oder mit Hinweis ablehnen kannst.
            </p>
          </div>
          ) : (
            <p className="text-[11px] text-muted-foreground rounded-md border border-border p-2">
              Das Freigabe-Gate gibt es aktuell nur für Claude Code und pi, die Sandbox nur für Claude Code. {PROVIDERS.find((p) => p.id === draft.provider)?.label} führt Dateiänderungen direkt im Projektordner aus.
            </p>
          )}
          <button
            onClick={createSession}
            disabled={creating || !draft.cwd || piBlocked}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Session starten
          </button>
          </>)}
        </div>

        <div className="space-y-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              aria-current={activeId === s.id ? "true" : undefined}
              className={`group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm ${
                activeId === s.id ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => openSession(s.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openSession(s.id);
                }
              }}
            >
              <div className="min-w-0">
                <div className="truncate font-medium flex items-center gap-1.5">
                  {s.status === "running" && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" title="läuft" />}
                  <span className="truncate">{s.title || "(neu)"}</span>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {s.provider} · {s.cwd.split("/").slice(-1)[0]} · ${s.totalCostUsd.toFixed(3)}
                </div>
              </div>
              {s.status === "running" ? (
                <button onClick={(e) => { e.stopPropagation(); stopSessionById(s.id); }} aria-label="stoppen"
                  className="text-amber-500 hover:text-amber-400 shrink-0" title="Aufgabe stoppen">
                  <Square size={13} />
                </button>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} aria-label="löschen"
                  title="Session löschen"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div
        className={maximized
          ? "fixed inset-0 z-50 bg-background flex flex-col"
          : "flex flex-col border border-border rounded-lg min-h-[65vh] lg:min-h-0 min-w-0"}
        style={maximized ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
      >
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
            Wähle links eine Session oder starte eine neue.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-2 min-w-0">
              <FolderGit2 size={13} className="shrink-0" />
              <span className="truncate" title={activeSession?.cwd}>
                {maximized ? (activeSession?.title || activeSession?.cwd) : activeSession?.cwd}
              </span>
              {reconnecting && (
                <span className="inline-flex items-center gap-1 text-amber-500 shrink-0" title="Verbindung wird wiederhergestellt…" role="status">
                  <WifiOff size={12} /> <span className="hidden sm:inline">Verbindung wird wiederhergestellt…</span>
                </span>
              )}
              <span className="ml-auto capitalize whitespace-nowrap hidden sm:inline">{activeSession?.provider}{activeSession?.model && ` · ${activeSession.model}`}</span>
              <button
                onClick={() => setMaximized((v) => !v)}
                aria-label={maximized ? "Verkleinern" : "Chat maximieren"}
                title={maximized ? "Verkleinern" : "Chat maximieren"}
                className="ml-auto sm:ml-0 shrink-0 p-1 rounded hover:bg-accent text-foreground"
              >
                {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>

            {/* Dev-server launcher */}
            <div className="border-b border-border px-4 py-2 text-xs space-y-1.5">
              {dev?.running ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-green-500 font-medium">
                    <Play size={12} /> App läuft · Port {dev.port}
                  </span>
                  <a
                    href={devHref(dev)}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-0.5 rounded bg-primary text-primary-foreground inline-flex items-center gap-1"
                  >
                    <ExternalLink size={11} /> Öffnen
                  </a>
                  <code className="px-1 bg-accent rounded truncate max-w-full">{devHref(dev)}</code>
                  <button onClick={() => setDevLogsOpen((v) => !v)} aria-expanded={devLogsOpen} className="px-2 py-0.5 rounded border border-input hover:bg-accent ml-auto">Logs</button>
                  <button
                    onClick={stopDevServer}
                    className="px-2 py-0.5 rounded bg-red-500/15 text-red-500 border border-red-500/40 hover:bg-red-500/25 inline-flex items-center gap-1 font-medium"
                  >
                    <Square size={11} /> App beenden
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    className="flex-1 min-w-[150px] rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
                    placeholder="Start-Befehl (z.B. npm run dev)"
                    aria-label="Start-Befehl"
                    value={devCmd}
                    onChange={(e) => setDevCmd(e.target.value)}
                  />
                  <input
                    type="number"
                    className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    placeholder="Port"
                    aria-label="Port"
                    value={devPort || ""}
                    onChange={(e) => setDevPort(Number(e.target.value))}
                  />
                  <button
                    onClick={startDevServer}
                    disabled={!devCmd.trim() || !devPort}
                    className="px-2 py-1 rounded bg-primary text-primary-foreground inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Play size={12} /> App starten
                  </button>
                </div>
              )}
              {dev && !dev.running && dev.exitInfo && (
                <p className="text-[11px] text-amber-500">{dev.exitInfo}</p>
              )}
              {devLogsOpen && dev?.logs && dev.logs.length > 0 && (
                <pre className="max-h-40 overflow-y-auto bg-accent/30 rounded p-2 text-[11px] whitespace-pre-wrap break-words leading-snug">
                  {dev.logs.join("\n")}
                </pre>
              )}
            </div>

            <div ref={threadRef} onScroll={onThreadScroll} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-h-0">
              {messages.length === 0 && live.items.length === 0 && !busy && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Stelle eine Aufgabe — der Assistent arbeitet im Verzeichnis oben.
                </p>
              )}
              {messages.map((m, i) => <MessageBubble key={m.id || `local-${i}`} msg={m} />)}
              {live.items.map((m, i) => <MessageBubble key={`live-${i}`} msg={m} />)}
              {busy && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                  <Loader2 size={12} className="animate-spin" />
                  <span>{planning ? "Plan wird erstellt…" : runningLabel(live, stopping)}</span>
                  {!planning && live.run?.origin === "telegram" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
                      <Send size={10} /> läuft via Telegram
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="border-t border-border px-3 pt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setMode((m) => (m === "orchestrate" ? "chat" : "orchestrate"))}
                className={toggleClass(mode === "orchestrate")}
                aria-pressed={mode === "orchestrate"}
                title="Aufgabe zerlegen und auf die stärksten Modelle verteilen"
              >
                <Network size={12} /> Orchestrator {mode === "orchestrate" ? "an" : "aus"}
              </button>
              <button
                onClick={() => setMode((m) => (m === "loop" ? "chat" : "loop"))}
                className={toggleClass(mode === "loop")}
                aria-pressed={mode === "loop"}
                title="Aufgabe wiederholen, bis der Agent das Abschluss-Signal ausgibt"
              >
                <Repeat size={12} /> Loop {mode === "loop" ? "an" : "aus"}
              </button>
              <button
                onClick={() => setUseKnowledge((v) => !v)}
                className={toggleClass(useKnowledge)}
                aria-pressed={useKnowledge}
                title="Relevanten Kontext aus der Wissensbasis (RAG) automatisch einfügen"
              >
                <BookOpen size={12} /> Wissensbasis {useKnowledge ? "an" : "aus"}
              </button>
              {orchestrateOn && (
                <>
                  <div className="flex rounded-md border border-input overflow-hidden text-xs" role="group" aria-label="Orchestrierungs-Modus">
                    {(["auto", "hybrid"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setOrchMode(m)}
                        aria-pressed={orchMode === m}
                        className={`px-2 py-1 ${orchMode === m ? "bg-accent font-medium" : "hover:bg-accent/50"}`}
                      >
                        {m === "auto" ? "Auto" : "Hybrid"}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={wizardEnabled} onChange={(e) => setWizardEnabled(e.target.checked)} />
                    Wizard
                  </label>
                  <select
                    value={plannerWorkerId}
                    onChange={(e) => setPlannerWorkerId(e.target.value)}
                    aria-label="Planer-Modell"
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs max-w-full"
                    title="Modell, das die Aufgabe plant und am Ende zusammenfasst (nicht zwingend Claude)"
                  >
                    <option value="">Planer: Auto</option>
                    {orchWorkers.map((w) => (
                      <option key={w.id} value={w.id}>Planer: {w.label}</option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted-foreground">
                    {orchMode === "hybrid" ? "Plan vor Ausführung editierbar." : "Voll automatisch."}
                  </span>
                </>
              )}
            </div>

            {/* Loop options */}
            {mode === "loop" && <LoopControls value={loopOpts} onChange={setLoopOpts} />}

            {/* Wizard panel */}
            {orchestrateOn && wizardEnabled && wizardOpen && (
              <div className="mx-3 mt-2 rounded-md border border-border p-3 space-y-2 text-sm">
                <div className="font-medium flex items-center gap-1.5"><Sparkles size={14} /> Projekt-Wizard</div>
                <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  placeholder="Stack / Sprache (z.B. Next.js + TypeScript)" aria-label="Stack / Sprache"
                  value={wizard.stack} onChange={(e) => setWizard({ ...wizard, stack: e.target.value })} />
                <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  placeholder="Rahmenbedingungen / No-Gos (optional)" aria-label="Rahmenbedingungen / No-Gos"
                  value={wizard.constraints} onChange={(e) => setWizard({ ...wizard, constraints: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  <select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" aria-label="Routing"
                    value={wizard.routing} onChange={(e) => setWizard({ ...wizard, routing: e.target.value })}>
                    <option value="balanced">Routing: ausgewogen</option>
                    <option value="quality">Routing: beste Qualität</option>
                    <option value="local">Routing: lokal/günstig bevorzugen</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={wizard.verify} onChange={(e) => setWizard({ ...wizard, verify: e.target.checked })} />
                    Verifikation/Test
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">Tippe deine Aufgabe unten ein und sende — die Antworten fließen in die Orchestrierung ein.</p>
              </div>
            )}

            {/* Hybrid plan editor */}
            {activePlan && (
              <div className="mx-3 mt-2 rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm max-h-[50vh] overflow-y-auto">
                <div className="font-medium flex items-center gap-1.5 text-primary"><Network size={14} /> Plan prüfen & Modelle zuweisen</div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 break-words" title={activePlan.prompt}>Aufgabe: {activePlan.prompt}</p>
                {activePlan.subtasks.map((st, idx) => (
                  <div key={st.id} className="flex flex-wrap sm:flex-nowrap items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-1.5 w-5 shrink-0">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm break-words">{st.title}</div>
                      {st.description && <div className="text-[11px] text-muted-foreground truncate">{st.description}</div>}
                    </div>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs shrink-0 max-w-full"
                      aria-label={`Modell für Teilaufgabe ${idx + 1}`}
                      value={st.workerId}
                      onChange={(e) => setPlanDraft((prev) => prev && ({
                        ...prev,
                        subtasks: prev.subtasks.map((x) => x.id === st.id ? { ...x, workerId: e.target.value } : x),
                      }))}
                    >
                      {activePlan.workers.map((w) => (
                        <option key={w.id} value={w.id}>{w.label}{w.editsFiles ? "" : " (kein Datei-Edit)"}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={runEditedPlan} disabled={busy}
                    className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    Ausführen
                  </button>
                  <button onClick={cancelPlan} className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent">
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {/* Approval gate + interactive questions of the attached run */}
            {hasCards && <PendingGates approvals={live.approvals} questions={live.questions} onDecide={decide} />}

            <div className="px-3 pb-3 pt-2 flex gap-2 items-end" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => uploadFiles(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || busy}
                aria-label="Dateien hochladen"
                title="Dateien ins Projekt hochladen"
                className="h-11 px-3 rounded-md border border-input hover:bg-accent disabled:opacity-50 shrink-0"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
              </button>
              <textarea
                className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none min-h-[44px] max-h-40 focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={
                  mode === "orchestrate" ? "Größere Aufgabe — wird zerlegt & verteilt…"
                    : mode === "loop" ? "Aufgabe, die wiederholt wird, bis sie erledigt ist…"
                    : "Aufgabe an den Assistenten…"
                }
                aria-label="Aufgabe"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
                }}
                disabled={busy}
              />
              {running ? (
                <button
                  onClick={() => void stop()}
                  disabled={stopping}
                  className="h-11 px-3 shrink-0 rounded-md border border-input hover:bg-accent disabled:opacity-60"
                  aria-label="Stop"
                  title="Ausführung stoppen"
                >
                  {stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim() || planning}
                  className="h-11 px-3 shrink-0 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  aria-label="Senden"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
