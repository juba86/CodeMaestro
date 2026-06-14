"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiKey } from "@/lib/ai/client-keys";
import {
  Plus, Send, Square, Trash2, Loader2, Terminal, Wrench, FileText,
  AlertCircle, FolderGit2, Network, Cpu, Sparkles, FolderPlus,
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

interface Workspace { path: string; label: string }

const PROVIDERS = [
  { id: "claude", label: "Claude Code" },
  { id: "gemini", label: "Gemini CLI" },
];

export function AssistantView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [live, setLive] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [orchestrateMode, setOrchestrateMode] = useState(false);
  const [orchMode, setOrchMode] = useState<"auto" | "hybrid">("auto");
  const [wizardEnabled, setWizardEnabled] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizard, setWizard] = useState({ stack: "", constraints: "", routing: "balanced", verify: false });
  const [planDraft, setPlanDraft] = useState<{ workers: { id: string; label: string; editsFiles?: boolean }[]; subtasks: PlannedSubtask[] } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [newFolder, setNewFolder] = useState("");

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [permissionModes, setPermissionModes] = useState<string[]>([]);

  const [draft, setDraft] = useState({
    provider: "claude",
    model: "",
    cwd: "",
    permissionMode: "default",
    allowedTools: ["Read", "Grep", "Glob"] as string[],
  });

  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSessions = useCallback(() => {
    fetch("/api/assistant/sessions").then((r) => r.json()).then((d) => setSessions(d.sessions || [])).catch(() => {});
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    fetch("/api/assistant/workspaces").then((r) => r.json()).then((d) => {
      setWorkspaces(d.workspaces || []);
      setTools(d.tools || []);
      setPermissionModes(d.permissionModes || ["default"]);
      setDraft((prev) => ({ ...prev, cwd: prev.cwd || d.workspaces?.[0]?.path || "" }));
    }).catch(() => {});
  }, []);

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

  const activeSession = sessions.find((s) => s.id === activeId);

  async function openSession(sid: string) {
    setActiveId(sid);
    setLive([]);
    const d = await fetch(`/api/assistant/sessions/${sid}`).then((r) => r.json());
    setMessages(d.session?.messages || []);
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
        body: JSON.stringify({ prompt, apiKey }),
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
            } else if (e.type === "tool_use") {
              assistantBuf = "";
              pushLive({ role: "tool_use", content: e.name || "tool", meta: JSON.stringify({ name: e.name, input: e.input }) });
            } else if (e.type === "tool_result") {
              pushLive({ role: "tool_result", content: e.content || "", meta: JSON.stringify({ isError: e.isError }) });
            } else if (e.type === "error" && e.content) {
              pushLive({ role: "error", content: e.content });
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

    if (orchMode === "hybrid") {
      setPendingPrompt(prompt);
      setRunning(true);
      try {
        const res = await fetch(`/api/assistant/sessions/${activeId}/orchestrate/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, preference }),
        });
        const d = await res.json();
        if (!res.ok) { toast.error(d.error || "Planung fehlgeschlagen."); return; }
        setPlanDraft({ workers: d.workers || [], subtasks: d.subtasks || [] });
      } finally {
        setRunning(false);
      }
      return;
    }
    await streamOrchestrate(`/api/assistant/sessions/${activeId}/orchestrate`, { prompt, preference });
  }

  async function runEditedPlan() {
    if (!planDraft || !activeId) return;
    const subtasks = planDraft.subtasks;
    setPlanDraft(null);
    await streamOrchestrate(`/api/assistant/sessions/${activeId}/orchestrate/run`, { prompt: pendingPrompt, subtasks });
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
    const res = await fetch("/api/assistant/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolder.trim(), parent: draft.cwd }),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || "Ordner konnte nicht erstellt werden."); return; }
    // Refresh the workspace list and select the new folder (ensure it's present
    // even if it's nested deeper than the listed immediate subdirectories).
    const ws = await fetch("/api/assistant/workspaces").then((r) => r.json()).catch(() => null);
    const list: Workspace[] = ws?.workspaces || workspaces;
    setWorkspaces(list.some((w) => w.path === d.path) ? list : [...list, { path: d.path, label: d.path }]);
    setDraft((prev) => ({ ...prev, cwd: d.path }));
    setNewFolder("");
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
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-7rem)]">
      {/* Sidebar: new session + list */}
      <div className="flex flex-col gap-3 overflow-y-auto pr-1">
        <h1 className="text-xl font-bold flex items-center gap-2"><Terminal size={18} /> Code Assistant</h1>

        <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
          <div className="font-medium">Neue Session</div>
          <select
            aria-label="Provider"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.provider}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          >
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select
            aria-label="Arbeitsverzeichnis"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.cwd}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
          >
            {workspaces.length === 0 && <option value="">Keine erlaubten Verzeichnisse</option>}
            {workspaces.map((w) => (
              <option key={w.path} value={w.path}>{w.label.split("/").slice(-2).join("/")}</option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <input
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              placeholder="Neuer Ordner (im gewählten Verzeichnis)"
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
          <button
            onClick={createSession}
            disabled={creating || !draft.cwd}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Session starten
          </button>
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
                <div className="truncate font-medium">{s.title || "(neu)"}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {s.provider} · {s.cwd.split("/").slice(-1)[0]} · ${s.totalCostUsd.toFixed(3)}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} aria-label="löschen"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-col border border-border rounded-lg min-h-0">
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Wähle links eine Session oder starte eine neue.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <FolderGit2 size={13} /> {activeSession?.cwd}
              <span className="ml-auto capitalize">{activeSession?.provider} {activeSession?.model && `· ${activeSession.model}`}</span>
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

            <div className="px-3 pb-3 pt-2 flex gap-2">
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
