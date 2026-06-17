"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { PROVIDERS as CHAT_PROVIDERS } from "@/lib/ai/catalog";
import {
  Plus, Send, Square, Trash2, Loader2, Terminal, Wrench, FileText,
  AlertCircle, FolderGit2, Network, Cpu, Sparkles, FolderPlus, Folder, ChevronUp, ExternalLink, Play,
  ChevronDown, Maximize2, Minimize2, Paperclip, ShieldCheck, Check, X, BookOpen,
} from "lucide-react";
import { toast } from "sonner";

interface SessionSummary {
  id: string;
  provider: string;
  model: string;
  title: string;
  cwd: string;
  status: string;
  totalCostUsd: number;
  messageCount: number;
  updatedAt: string;
}

interface Msg {
  id?: string;
  role: string; // user | assistant | tool_use | tool_result | system | error | plan | synthesis
  content: string;
  meta?: string;
  _streaming?: boolean;
  _subtaskId?: string;
}

interface PlannedSubtask {
  id: string;
  title: string;
  workerId: string;
  description: string;
  dependsOn: string[];
  editsFiles: boolean;
}

interface BrowseState {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

interface DiffPart { op: "equal" | "add" | "del"; text: string }
interface ApprovalCard {
  approvalId: string;
  tool: string; // Edit | Write | MultiEdit | Bash
  command?: string;
  filePath?: string;
  isWrite?: boolean;
  diff?: DiffPart[];
}

const PROVIDERS = [
  { id: "claude", label: "Claude Code" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "opencode", label: "OpenCode" },
  { id: "codex", label: "Codex CLI" },
  { id: "aider", label: "Aider" },
];

// Approval-gate + sandbox are Claude-Code-specific (PreToolUse hooks).
const APPROVAL_CAPABLE = new Set(["claude"]);

export function AssistantView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [live, setLive] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [orchestrateMode, setOrchestrateMode] = useState(false);
  // RAG: augment turns with relevant knowledge-base context (default on; the
  // server no-ops gracefully when the index is empty or Ollama is unreachable).
  const [useKnowledge, setUseKnowledge] = useState(true);
  const [orchMode, setOrchMode] = useState<"auto" | "hybrid">("auto");
  const [wizardEnabled, setWizardEnabled] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizard, setWizard] = useState({ stack: "", constraints: "", routing: "balanced", verify: false });
  const [planDraft, setPlanDraft] = useState<{ workers: { id: string; label: string; editsFiles?: boolean }[]; subtasks: PlannedSubtask[] } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [newFolder, setNewFolder] = useState("");

  const [browse, setBrowse] = useState<BrowseState | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [permissionModes, setPermissionModes] = useState<string[]>([]);

  // Dev-server launcher state for the active session.
  const [dev, setDev] = useState<{ running: boolean; port?: number; command?: string; logs?: string[]; exitInfo?: string } | null>(null);
  const [devCmd, setDevCmd] = useState("");
  const [devPort, setDevPort] = useState<number>(0);
  const [devLogsOpen, setDevLogsOpen] = useState(false);
  const devPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mobile/UX: maximize the chat to full screen; collapse the new-session config.
  const [maximized, setMaximized] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const [draft, setDraft] = useState({
    provider: "claude",
    model: "",
    cwd: "",
    permissionMode: "default",
    allowedTools: ["Read", "Grep", "Glob"] as string[],
    approvalMode: "off" as "off" | "edits" | "all",
    sandbox: false,
  });

  // Pending tool approvals (diff/command gate) awaiting the user's decision.
  const [approvals, setApprovals] = useState<ApprovalCard[]>([]);

  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0 || !activeId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/assistant/sessions/${activeId}/upload`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "Upload fehlgeschlagen."); return; }
      toast.success(`${d.saved.length} Datei(en) hochgeladen: ${d.saved.join(", ")}`);
      if (d.saved.length) {
        setInput((prev) => prev
          ? prev
          : `Ich habe folgende Dateien ins Projekt hochgeladen: ${d.saved.join(", ")}. `);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const loadSessions = useCallback(() => {
    fetch("/api/assistant/sessions").then((r) => r.json()).then((d) => setSessions(d.sessions || [])).catch(() => {});
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Open the new-session config by default only when there's nothing to show yet.
  useEffect(() => {
    if (sessions.length === 0 && !activeId) setConfigOpen(true);
  }, [sessions.length, activeId]);

  // Keep the session list (running badges) fresh while anything is running.
  const anyRunning = sessions.some((s) => s.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => loadSessions(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, loadSessions]);

  // Handoff from the Prompt Builder: a prompt was sent over → prefill the input.
  useEffect(() => {
    const handoff = sessionStorage.getItem("pb-assistant-prompt");
    if (handoff) {
      sessionStorage.removeItem("pb-assistant-prompt");
      setInput(handoff);
      setConfigOpen(true);
      toast.info("Prompt übernommen — wähle/erstelle eine Session und sende ihn ab.");
    }
  }, []);

  useEffect(() => {
    fetch("/api/assistant/workspaces").then((r) => r.json()).then((d) => {
      setTools(d.tools || []);
      setPermissionModes(d.permissionModes || ["default"]);
    }).catch(() => {});
    loadBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Folder browser: navigate the allowed directory tree; the browsed folder is
  // the working directory the session will run in.
  async function loadBrowse(path?: string) {
    const url = path ? `/api/assistant/browse?path=${encodeURIComponent(path)}` : "/api/assistant/browse";
    const d = await fetch(url).then((r) => r.json()).catch(() => null);
    if (d?.path) {
      setBrowse({ path: d.path, parent: d.parent ?? null, dirs: d.dirs || [] });
      setDraft((prev) => ({ ...prev, cwd: d.path }));
    }
  }

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live]);

  // When returning to the tab (e.g. after mobile standby), reload the active
  // session so any work that finished in the background is shown immediately.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && activeId && !running) {
        openSession(activeId);
        loadSessions();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, running]);

  // Poll the dev-server status (logs/exit) while it's running.
  useEffect(() => {
    if (devPollRef.current) { clearInterval(devPollRef.current); devPollRef.current = null; }
    if (activeId && dev?.running) {
      devPollRef.current = setInterval(() => loadDev(activeId), 3000);
    }
    return () => { if (devPollRef.current) clearInterval(devPollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, dev?.running]);

  const activeSession = sessions.find((s) => s.id === activeId);

  async function openSession(sid: string) {
    setActiveId(sid);
    setLive([]);
    const d = await fetch(`/api/assistant/sessions/${sid}`).then((r) => r.json());
    setMessages(d.session?.messages || []);
    loadDev(sid);
  }

  async function loadDev(sid: string) {
    const d = await fetch(`/api/assistant/sessions/${sid}/dev`).then((r) => r.json()).catch(() => null);
    if (!d) return;
    setDev(d);
    if (d.suggestion) { setDevCmd(d.suggestion.command); setDevPort(d.suggestion.port); }
    else if (d.command && d.port) { setDevCmd(d.command); setDevPort(d.port); }
  }

  async function startDevServer() {
    if (!activeId || !devCmd.trim() || !devPort) return;
    const res = await fetch(`/api/assistant/sessions/${activeId}/dev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: devCmd, port: devPort }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "Start fehlgeschlagen."); return; }
    setDev(d);
    setDevLogsOpen(true);
    toast.success(`App gestartet auf Port ${devPort}.`);
  }

  async function stopDevServer() {
    if (!activeId) return;
    await fetch(`/api/assistant/sessions/${activeId}/dev/stop`, { method: "POST" });
    await loadDev(activeId);
    toast.info("App gestoppt.");
  }

  function devLink(port: number) {
    if (typeof window === "undefined") return `:${port}`;
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }

  async function createSession() {
    setCreating(true);
    try {
      const res = await fetch("/api/assistant/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, allowedTools: draft.allowedTools.join(",") }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "Konnte Session nicht anlegen."); return; }
      await loadSessions();
      setActiveId(d.session.id);
      setMessages([]);
      setLive([]);
      toast.success("Session angelegt.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteSession(sid: string) {
    if (!window.confirm("Session löschen?")) return;
    await fetch(`/api/assistant/sessions/${sid}`, { method: "DELETE" });
    if (activeId === sid) { setActiveId(null); setMessages([]); }
    loadSessions();
  }

  async function stop() {
    if (!activeId) return;
    await fetch(`/api/assistant/sessions/${activeId}/stop`, { method: "POST" });
    abortRef.current?.abort();
  }

  // Stop a (possibly background) run in any session from the session list.
  async function stopSessionById(sid: string) {
    await fetch(`/api/assistant/sessions/${sid}/stop`, { method: "POST" }).catch(() => {});
    if (sid === activeId) abortRef.current?.abort();
    loadSessions();
    if (sid === activeId) await openSession(sid);
    toast.info("Aufgabe gestoppt.");
  }

  // Poll a session until it is no longer "running", updating the transcript.
  // Used after a dropped connection (mobile standby) — the server keeps working.
  async function pollSessionUntilIdle(sid: string) {
    for (let i = 0; i < 240; i++) {
      const d = await fetch(`/api/assistant/sessions/${sid}`).then((r) => r.json()).catch(() => null);
      if (d?.session) {
        setMessages(d.session.messages || []);
        if (d.session.status !== "running") return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Shared cleanup after a stream ends. If it ended cleanly (or the user stopped),
  // reload the transcript; if the connection dropped, poll for the background result.
  async function settleStream(gotDone: boolean) {
    setRunning(false);
    abortRef.current = null;
    setLive([]);
    setApprovals([]);
    if (!activeId) return;
    if (gotDone) {
      await openSession(activeId);
    } else {
      toast.info("Verbindung unterbrochen — Aufgabe läuft im Hintergrund weiter.");
      setRunning(true);
      await pollSessionUntilIdle(activeId);
      setRunning(false);
    }
    loadSessions();
  }

  async function send() {
    if (!input.trim() || running || !activeId) return;
    if (orchestrateMode) { void orchestrate(); return; }
    const prompt = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setLive([]);
    setRunning(true);

    const apiKey = activeSession?.provider === "gemini" ? await getApiKey("gemini") : undefined;
    const controller = new AbortController();
    abortRef.current = controller;

    // Accumulate live events; assistant text is merged into one growing bubble.
    let assistantBuf = "";
    let gotDone = false;
    const pushLive = (m: Msg) => setLive((prev) => [...prev, m]);

    try {
      const res = await fetch(`/api/assistant/sessions/${activeId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, apiKey, useKnowledge }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || "Anfrage fehlgeschlagen.");
        gotDone = true;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { gotDone = true; break; }
          try {
            const e = JSON.parse(data);
            if (e.type === "text" && e.content) {
              assistantBuf += e.content;
              setLive((prev) => {
                const next = [...prev];
                const lastAssistant = [...next].reverse().find((m) => m.role === "assistant" && m._streaming);
                if (lastAssistant) { lastAssistant.content = assistantBuf; return next; }
                next.push({ role: "assistant", content: assistantBuf, _streaming: true } as Msg & { _streaming: boolean });
                return next;
              });
            } else if (e.type === "knowledge") {
              const sources: string[] = e.sources || [];
              pushLive({ role: "knowledge", content: `${sources.length} Quelle(n) aus der Wissensbasis`, meta: JSON.stringify({ sources }) });
            } else if (e.type === "tool_use") {
              assistantBuf = "";
              pushLive({ role: "tool_use", content: e.name || "tool", meta: JSON.stringify({ name: e.name, input: e.input }) });
            } else if (e.type === "tool_result") {
              pushLive({ role: "tool_result", content: e.content || "", meta: JSON.stringify({ isError: e.isError }) });
            } else if (e.type === "error" && e.content) {
              pushLive({ role: "error", content: e.content });
            } else if (e.type === "approval_request") {
              setApprovals((prev) => [...prev, {
                approvalId: e.approvalId, tool: e.tool, command: e.command,
                filePath: e.filePath, isWrite: e.isWrite, diff: e.diff,
              }]);
            } else if (e.type === "approval_resolved") {
              setApprovals((prev) => prev.filter((a) => a.approvalId !== e.approvalId));
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      // AbortError = user pressed Stop (server already stopped & set idle).
      if (err instanceof DOMException && err.name === "AbortError") gotDone = true;
    } finally {
      await settleStream(gotDone);
    }
  }

  // Resolve a pending tool approval. reason (on deny) steers the model mid-run.
  async function decideApproval(approvalId: string, decision: "allow" | "deny", reason?: string) {
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
    try {
      await fetch(`/api/assistant/approval/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
    } catch {
      toast.error("Freigabe konnte nicht übermittelt werden.");
    }
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

  async function orchestrate() {
    if (orchestrateMode && wizardEnabled && !wizardOpen) {
      setWizardOpen(true);
      return;
    }
    if (!input.trim() || running || !activeId) return;
    const preference = buildPreference();
    const prompt = input;
    setInput("");
    setWizardOpen(false);
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setLive([]);

    const clientProviders = await gatherClientProviders();

    if (orchMode === "hybrid") {
      setPendingPrompt(prompt);
      setRunning(true);
      try {
        const res = await fetch(`/api/assistant/sessions/${activeId}/orchestrate/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, preference, clientProviders }),
        });
        const d = await res.json();
        if (!res.ok) { toast.error(d.error || "Planung fehlgeschlagen."); return; }
        setPlanDraft({ workers: d.workers || [], subtasks: d.subtasks || [] });
      } finally {
        setRunning(false);
      }
      return;
    }
    await streamOrchestrate(`/api/assistant/sessions/${activeId}/orchestrate`, { prompt, preference, clientProviders });
  }

  async function runEditedPlan() {
    if (!planDraft || !activeId) return;
    const subtasks = planDraft.subtasks;
    setPlanDraft(null);
    const clientProviders = await gatherClientProviders();
    await streamOrchestrate(`/api/assistant/sessions/${activeId}/orchestrate/run`, { prompt: pendingPrompt, subtasks, clientProviders });
  }

  async function streamOrchestrate(url: string, body: object) {
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const updateSubtask = (sid: string, fn: (m: Msg) => void) => {
      setLive((prev) => {
        const next = [...prev];
        const m = next.find((x) => x._subtaskId === sid && x.role === "assistant");
        if (m) fn(m);
        return next;
      });
    };

    const taskText = (body as { prompt?: string }).prompt || "";
    let gotDone = false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || "Orchestrierung fehlgeschlagen.");
        gotDone = true;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let synthBuf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { gotDone = true; break; }
          try {
            const e = JSON.parse(data);
            if (e.type === "plan") {
              setLive((prev) => [...prev, { role: "plan", content: taskText, meta: JSON.stringify({ subtasks: e.subtasks }) }]);
            } else if (e.type === "subtask_start") {
              setLive((prev) => [...prev, {
                role: "assistant", content: "",
                meta: JSON.stringify({ subtaskId: e.subtaskId, title: e.title, worker: e.workerLabel, workerId: e.workerId }),
                _streaming: true, _subtaskId: e.subtaskId,
              }]);
            } else if (e.type === "subtask_text" && e.subtaskId) {
              updateSubtask(e.subtaskId, (m) => { m.content += e.content; });
            } else if (e.type === "subtask_end" && e.subtaskId) {
              updateSubtask(e.subtaskId, (m) => { m._streaming = false; });
            } else if (e.type === "synthesis") {
              synthBuf += e.content;
              setLive((prev) => {
                const next = [...prev];
                const m = [...next].reverse().find((x) => x.role === "synthesis");
                if (m) { m.content = synthBuf; return next; }
                next.push({ role: "synthesis", content: synthBuf });
                return next;
              });
            } else if (e.type === "error") {
              setLive((prev) => [...prev, { role: "error", content: e.content }]);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") gotDone = true;
    } finally {
      await settleStream(gotDone);
    }
  }

  async function createFolder() {
    if (!newFolder.trim()) return;
    const parent = browse?.path || draft.cwd;
    const res = await fetch("/api/assistant/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolder.trim(), parent }),
    });
    const d = await res.json();
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

  const thread = [...messages, ...live];

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_1fr] lg:h-[calc(100vh-7rem)]">
      {/* Sidebar: new session + list — hidden when the chat is maximized */}
      <div className={`flex-col gap-3 lg:overflow-y-auto pr-1 ${maximized ? "hidden" : "flex"}`}>
        <h1 className="text-xl font-bold flex items-center gap-2"><Terminal size={18} /> Code Assistant</h1>

        <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
          <button
            onClick={() => setConfigOpen((v) => !v)}
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
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
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
                  <Folder size={12} className="text-muted-foreground shrink-0" /> {dir.name}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Session startet in: <span className="font-medium text-foreground">{browse?.path.split("/").slice(-1)[0] || "—"}</span>
          </p>
          <div className="flex gap-1.5">
            <input
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              placeholder="Neuer Ordner (hier anlegen)"
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
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="Modell (optional, z.B. opus / sonnet)"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
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
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.sandbox}
                onChange={(e) => setDraft({ ...draft, sandbox: e.target.checked })}
              />
              Sandbox (Schreibzugriff auf Projekt begrenzen)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Bei aktivierter Freigabe zeigt der Assistent vor jedem Edit/Write{draft.approvalMode === "all" ? "/Bash" : ""} einen Diff bzw. Befehl, den du freigeben oder mit Hinweis ablehnen kannst.
            </p>
          </div>
          ) : (
            <p className="text-[11px] text-muted-foreground rounded-md border border-border p-2">
              Freigabe-Gate &amp; Sandbox sind aktuell nur für Claude Code verfügbar. {PROVIDERS.find((p) => p.id === draft.provider)?.label} führt Dateiänderungen direkt im Projektordner aus.
            </p>
          )}
          <button
            onClick={createSession}
            disabled={creating || !draft.cwd}
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
              className={`group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm ${
                activeId === s.id ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => openSession(s.id)}
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
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className={maximized
        ? "fixed inset-0 z-50 bg-background flex flex-col"
        : "flex flex-col border border-border rounded-lg min-h-[65vh] lg:min-h-0"}>
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Wähle links eine Session oder starte eine neue.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <FolderGit2 size={13} className="shrink-0" />
              <span className="truncate" title={activeSession?.cwd}>
                {maximized ? (activeSession?.title || activeSession?.cwd) : activeSession?.cwd}
              </span>
              <span className="ml-auto capitalize whitespace-nowrap hidden sm:inline">{activeSession?.provider}{activeSession?.model && ` · ${activeSession.model}`}</span>
              <button
                onClick={() => setMaximized((v) => !v)}
                aria-label={maximized ? "Verkleinern" : "Chat maximieren"}
                title={maximized ? "Verkleinern" : "Chat maximieren"}
                className="shrink-0 p-1 rounded hover:bg-accent text-foreground"
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
                    href={devLink(dev.port!)}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-0.5 rounded bg-primary text-primary-foreground inline-flex items-center gap-1"
                  >
                    <ExternalLink size={11} /> Öffnen
                  </a>
                  <code className="px-1 bg-accent rounded">{devLink(dev.port!)}</code>
                  <button onClick={() => setDevLogsOpen((v) => !v)} className="px-2 py-0.5 rounded border border-input hover:bg-accent ml-auto">Logs</button>
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
                    value={devCmd}
                    onChange={(e) => setDevCmd(e.target.value)}
                  />
                  <input
                    type="number"
                    className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    placeholder="Port"
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
                <pre className="max-h-40 overflow-y-auto bg-accent/30 rounded p-2 text-[11px] whitespace-pre-wrap leading-snug">
                  {dev.logs.join("\n")}
                </pre>
              )}
            </div>

            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {thread.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Stelle eine Aufgabe — der Assistent arbeitet im Verzeichnis oben.
                </p>
              )}
              {thread.map((m, i) => <MessageBubble key={m.id || `live-${i}`} msg={m} />)}
              {running && <div className="text-xs text-muted-foreground animate-pulse">Assistent arbeitet…</div>}
            </div>
            <div className="border-t border-border px-3 pt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setOrchestrateMode((v) => !v)}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border ${
                  orchestrateMode ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"
                }`}
                title="Aufgabe zerlegen und auf die stärksten Modelle verteilen"
              >
                <Network size={12} /> Orchestrator {orchestrateMode ? "an" : "aus"}
              </button>
              <button
                onClick={() => setUseKnowledge((v) => !v)}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border ${
                  useKnowledge ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"
                }`}
                title="Relevanten Kontext aus der Wissensbasis (RAG) automatisch einfügen"
              >
                <BookOpen size={12} /> Wissensbasis {useKnowledge ? "an" : "aus"}
              </button>
              {orchestrateMode && (
                <>
                  <div className="flex rounded-md border border-input overflow-hidden text-xs">
                    {(["auto", "hybrid"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setOrchMode(m)}
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
                  <span className="text-[11px] text-muted-foreground">
                    {orchMode === "hybrid" ? "Plan vor Ausführung editierbar." : "Voll automatisch."}
                  </span>
                </>
              )}
            </div>

            {/* Wizard panel */}
            {orchestrateMode && wizardEnabled && wizardOpen && (
              <div className="mx-3 mt-2 rounded-md border border-border p-3 space-y-2 text-sm">
                <div className="font-medium flex items-center gap-1.5"><Sparkles size={14} /> Projekt-Wizard</div>
                <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  placeholder="Stack / Sprache (z.B. Next.js + TypeScript)"
                  value={wizard.stack} onChange={(e) => setWizard({ ...wizard, stack: e.target.value })} />
                <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  placeholder="Rahmenbedingungen / No-Gos (optional)"
                  value={wizard.constraints} onChange={(e) => setWizard({ ...wizard, constraints: e.target.value })} />
                <div className="flex items-center gap-2">
                  <select className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
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
            {planDraft && (
              <div className="mx-3 mt-2 rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm">
                <div className="font-medium flex items-center gap-1.5 text-primary"><Network size={14} /> Plan prüfen & Modelle zuweisen</div>
                {planDraft.subtasks.map((st, idx) => (
                  <div key={st.id} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-1.5 w-5 shrink-0">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{st.title}</div>
                      {st.description && <div className="text-[11px] text-muted-foreground truncate">{st.description}</div>}
                    </div>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs shrink-0"
                      value={st.workerId}
                      onChange={(e) => setPlanDraft((prev) => prev && ({
                        ...prev,
                        subtasks: prev.subtasks.map((x) => x.id === st.id ? { ...x, workerId: e.target.value } : x),
                      }))}
                    >
                      {planDraft.workers.map((w) => (
                        <option key={w.id} value={w.id}>{w.label}{w.editsFiles ? "" : " (kein Datei-Edit)"}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={runEditedPlan} disabled={running}
                    className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    Ausführen
                  </button>
                  <button onClick={() => setPlanDraft(null)} className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent">
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {/* Approval gate: diff/command cards awaiting the user's decision */}
            {approvals.length > 0 && (
              <div className="mx-3 mt-2 space-y-2">
                {approvals.map((a) => (
                  <ApprovalGate key={a.approvalId} card={a} onDecide={decideApproval} />
                ))}
              </div>
            )}

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
                disabled={uploading || running}
                aria-label="Dateien hochladen"
                title="Dateien ins Projekt hochladen"
                className="px-3 py-2 rounded-md border border-input hover:bg-accent disabled:opacity-50 shrink-0"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
              </button>
              <textarea
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none min-h-[44px] max-h-40 focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={orchestrateMode ? "Größere Aufgabe — wird zerlegt & verteilt…" : "Aufgabe an den Assistenten…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                disabled={running}
              />
              {running ? (
                <button onClick={stop} className="px-3 rounded-md border border-input hover:bg-accent" aria-label="Stop">
                  <Square size={16} />
                </button>
              ) : (
                <button onClick={send} disabled={!input.trim()} className="px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" aria-label="Senden">
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

function ApprovalGate({ card, onDecide }: { card: ApprovalCard; onDecide: (id: string, d: "allow" | "deny", reason?: string) => void }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isBash = card.tool === "Bash";
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-1.5 font-semibold text-amber-500">
        <ShieldCheck size={14} />
        Freigabe nötig: {card.tool}
        {card.filePath && <span className="font-normal text-xs text-muted-foreground truncate">· {card.filePath}</span>}
      </div>
      {isBash ? (
        <pre className="bg-background/60 rounded p-2 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto border border-border">{card.command}</pre>
      ) : (
        <pre className="bg-background/60 rounded p-2 text-xs max-h-64 overflow-y-auto border border-border leading-snug">
          {(card.diff || []).map((d, i) => (
            <div key={i} className={
              d.op === "add" ? "text-green-500 bg-green-500/10"
                : d.op === "del" ? "text-red-500 bg-red-500/10"
                : "text-muted-foreground"
            }>
              <span className="select-none opacity-60">{d.op === "add" ? "+ " : d.op === "del" ? "- " : "  "}</span>
              {d.text || " "}
            </div>
          ))}
        </pre>
      )}
      {reasonOpen && (
        <textarea
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm resize-none min-h-[44px]"
          placeholder="Hinweis an den Assistenten (warum abgelehnt / was stattdessen tun)…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onDecide(card.approvalId, "allow")}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-green-600 text-white hover:bg-green-500"
        >
          <Check size={13} /> Freigeben
        </button>
        {reasonOpen ? (
          <button
            onClick={() => onDecide(card.approvalId, "deny", reason.trim() || undefined)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-destructive text-white hover:opacity-90"
          >
            <X size={13} /> Ablehnen + Hinweis senden
          </button>
        ) : (
          <>
            <button
              onClick={() => onDecide(card.approvalId, "deny")}
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

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm">
        <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
      </div>
    );
  }
  if (msg.role === "plan") {
    let subtasks: PlannedSubtask[] = [];
    try { subtasks = JSON.parse(msg.meta || "{}").subtasks || []; } catch { /* */ }
    return (
      <div className="max-w-[95%] border border-primary/40 bg-primary/5 rounded-lg px-3 py-2 text-sm">
        <div className="flex items-center gap-1.5 font-semibold text-primary mb-1"><Network size={14} /> Orchestrierungsplan</div>
        <ol className="space-y-1 list-decimal list-inside">
          {subtasks.map((s) => (
            <li key={s.id} className="text-sm">
              {s.title}
              <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-[11px]">
                <Cpu size={10} /> {s.workerId}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (msg.role === "synthesis") {
    return (
      <div className="max-w-[95%] border border-green-500/40 bg-green-500/5 rounded-lg px-3 py-2 text-sm">
        <div className="flex items-center gap-1.5 font-semibold text-green-500 mb-1"><Sparkles size={14} /> Zusammenfassung</div>
        <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
      </div>
    );
  }
  if (msg.role === "assistant") {
    let worker = "";
    let title = "";
    try { const m = JSON.parse(msg.meta || "{}"); worker = m.worker || ""; title = m.title || ""; } catch { /* */ }
    return (
      <div className="max-w-[90%] bg-accent rounded-lg px-3 py-2 text-sm">
        {worker && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            <Cpu size={11} /> {worker}{title && ` · ${title}`}
          </div>
        )}
        <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
      </div>
    );
  }
  if (msg.role === "knowledge") {
    let sources: string[] = [];
    try { sources = JSON.parse(msg.meta || "{}").sources || []; } catch { /* */ }
    return (
      <div className="max-w-[90%] rounded-lg px-3 py-2 text-xs border border-violet-500/40 bg-violet-500/5 text-violet-300 flex items-start gap-1.5">
        <BookOpen size={13} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium">Wissensbasis genutzt</span>
          {sources.length > 0 && <span className="text-muted-foreground"> · {sources.join(", ")}</span>}
        </div>
      </div>
    );
  }
  if (msg.role === "tool_use") {
    let input = "";
    try { const m = JSON.parse(msg.meta || "{}"); input = JSON.stringify(m.input, null, 2); } catch { /* */ }
    return (
      <div className="max-w-[90%] border border-border rounded-lg px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-blue-400"><Wrench size={12} /> {msg.content}</div>
        {input && input !== "undefined" && (
          <pre className="mt-1 whitespace-pre-wrap text-muted-foreground max-h-32 overflow-y-auto">{input.slice(0, 1200)}</pre>
        )}
      </div>
    );
  }
  if (msg.role === "tool_result") {
    let isError = false;
    try { isError = JSON.parse(msg.meta || "{}").isError; } catch { /* */ }
    return (
      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs border ${isError ? "border-red-500/40" : "border-border"}`}>
        <div className="flex items-center gap-1.5 text-muted-foreground"><FileText size={12} /> Ergebnis</div>
        <pre className="mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">{(msg.content || "").slice(0, 2000)}</pre>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="max-w-[90%] rounded-lg px-3 py-2 text-xs border border-red-500/40 text-red-400 flex items-start gap-1.5">
        <AlertCircle size={13} className="mt-0.5 shrink-0" />
        <pre className="whitespace-pre-wrap">{msg.content}</pre>
      </div>
    );
  }
  return null;
}
