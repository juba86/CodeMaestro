"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X, Send } from "lucide-react";
import { toast } from "sonner";

interface PublicConfig {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked: string;
  allowedChatIds: number[];
  cwd: string;
  permissionMode: string;
  approvalMode: string;
  provider: string;
  model: string;
  useKnowledge: boolean;
}
interface Status {
  running: boolean;
  startedAt: number;
  error: string;
  botUsername: string;
  boundChats: number;
}

const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
const APPROVAL_MODES = ["off", "edits", "all"];
const PROVIDERS = ["claude", "gemini", "opencode", "codex", "aider", "pi"];

export function TelegramSettings() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [workspaces, setWorkspaces] = useState<{ path: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Local editable copy of the non-secret fields.
  const [draft, setDraft] = useState({
    enabled: false,
    cwd: "",
    permissionMode: "default",
    approvalMode: "edits",
    provider: "claude",
    model: "",
    useKnowledge: true,
  });

  async function refresh() {
    const d = await fetch("/api/assistant/telegram").then((r) => r.json()).catch(() => null);
    if (!d?.config) return;
    setConfig(d.config);
    setStatus(d.status);
    setChatIds((d.config.allowedChatIds || []).join(", "));
    setDraft({
      enabled: d.config.enabled,
      cwd: d.config.cwd || "",
      permissionMode: d.config.permissionMode || "default",
      approvalMode: d.config.approvalMode || "edits",
      provider: d.config.provider || "claude",
      model: d.config.model || "",
      useKnowledge: d.config.useKnowledge ?? true,
    });
  }

  useEffect(() => {
    refresh();
    fetch("/api/assistant/workspaces").then((r) => r.json()).then((d) => setWorkspaces(d.workspaces || [])).catch(() => {});
  }, []);

  function parseChatIds(s: string): number[] {
    return s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n));
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        enabled: draft.enabled,
        allowedChatIds: parseChatIds(chatIds),
        cwd: draft.cwd,
        permissionMode: draft.permissionMode,
        approvalMode: draft.approvalMode,
        provider: draft.provider,
        model: draft.model,
        useKnowledge: draft.useKnowledge,
      };
      // Only send the token if the user typed a new one (empty leaves it; "-" clears).
      if (token.trim() === "-") payload.token = "";
      else if (token.trim()) payload.token = token.trim();

      const res = await fetch("/api/assistant/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error || "Speichern fehlgeschlagen.");
        return;
      }
      setToken("");
      setConfig(d.config);
      setStatus(d.status);
      if (d.startError) toast.error(`Gespeichert, aber Bridge-Start fehlgeschlagen: ${d.startError}`);
      else toast.success(draft.enabled ? "Gespeichert — Bridge läuft." : "Gespeichert.");
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function testTokenNow() {
    setTesting(true);
    try {
      const res = await fetch("/api/assistant/telegram/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", token: token.trim() || undefined }),
      });
      const d = await res.json();
      if (d.ok) toast.success(`Token gültig${d.username ? ` — @${d.username}` : ""}.`);
      else toast.error(d.error || "Token ungültig.");
    } catch {
      toast.error("Test fehlgeschlagen.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Send size={18} className="text-primary" />
        <h2 className="text-lg font-semibold">Telegram-Fallback</h2>
        {status?.running ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-500 flex items-center gap-1">
            <Check size={11} /> aktiv{status.botUsername ? ` · @${status.botUsername}` : ""}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent text-muted-foreground">inaktiv</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Die PWA bleibt primär (über Tailscale). Wenn du nicht im Tailscale bist, kannst du den
        Assistant optional per Telegram steuern. Kein Zwang — aktivieren nur wenn gewünscht.
        Bot-Token via <code className="px-1 bg-accent rounded">@BotFather</code> erstellen.
      </p>

      {status?.error && <p className="text-xs text-red-500">Fehler: {status.error}</p>}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
        Telegram-Bridge aktivieren
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.useKnowledge} onChange={(e) => setDraft((d) => ({ ...d, useKnowledge: e.target.checked }))} />
        Wissensbasis (RAG) in Antworten einbeziehen
      </label>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Bot-Token</label>
        <div className="flex gap-2">
          <input
            type="password"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={config?.hasToken ? `gespeichert (${config.tokenMasked}) — leer lassen, „-" zum Löschen` : "123456:AA…"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            onClick={testTokenNow}
            disabled={testing}
            className="px-3 py-2 text-sm rounded-md border border-input hover:bg-accent disabled:opacity-50 flex items-center gap-1"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : "Token testen"}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Erlaubte Chat-IDs</label>
        <input
          type="text"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="z.B. 123456789, 987654321 — per /whoami im Bot herausfinden"
          value={chatIds}
          onChange={(e) => setChatIds(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Nur diese Telegram-Chats dürfen den Bot steuern. Schreib dem Bot <code className="px-1 bg-accent rounded">/whoami</code>, um deine ID zu erfahren.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Arbeitsverzeichnis</label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={draft.cwd}
          onChange={(e) => setDraft((d) => ({ ...d, cwd: e.target.value }))}
        >
          <option value="">— wählen —</option>
          {workspaces.map((w) => (
            <option key={w.path} value={w.path}>{w.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Provider</label>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.provider} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Permission-Mode</label>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.permissionMode} onChange={(e) => setDraft((d) => ({ ...d, permissionMode: e.target.value }))}>
            {PERMISSION_MODES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Approval-Gate</label>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.approvalMode} onChange={(e) => setDraft((d) => ({ ...d, approvalMode: e.target.value }))}>
            {APPROVAL_MODES.map((p) => <option key={p} value={p}>{p === "off" ? "aus" : p === "edits" ? "bei Datei-Edits" : "bei Edits + Bash"}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Modell (optional)</label>
          <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="leer = Default" value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Speichern & anwenden
        </button>
        {status && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {status.running ? <Check size={12} className="text-green-500" /> : <X size={12} className="text-muted-foreground" />}
            {status.running ? `Bridge läuft (${status.boundChats} Chats)` : "Bridge gestoppt"}
          </span>
        )}
      </div>
    </section>
  );
}
