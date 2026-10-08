"use client";

import { useEffect, useState } from "react";
import { Check, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { confirm } from "@/components/ui/confirm";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchRow } from "@/components/ui/switch";
import { APPROVAL_CAPABLE } from "@/components/assistant/new-session";
import { approvalModeLabel, permissionModeLabel, providerLabel } from "@/lib/labels";
import { publishTelegramHint } from "./settings-hints";
import { Code, SectionHeader, SettingsCard } from "./settings-ui";

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

function parseChatIds(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));
}

export function TelegramSettings() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [status, setStatusState] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
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

  function setStatus(s: Status | null) {
    setStatusState(s);
    publishTelegramHint(s);
  }

  async function refresh() {
    const d = await fetch("/api/assistant/telegram").then((r) => r.json()).catch(() => null);
    if (!d?.config) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
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
    void refresh();
    fetch("/api/assistant/workspaces").then((r) => r.json()).then((d) => setWorkspaces(d.workspaces || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  /** `tokenOverride`: "" removes the stored token (what the old „-" convention sent). */
  async function save(tokenOverride?: string) {
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
      // Only send the token if the user typed a new one (empty leaves it).
      if (tokenOverride !== undefined) payload.token = tokenOverride;
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
      if (d.startError) toast.error(`Gespeichert, aber die Bridge startet nicht: ${d.startError}`);
      else if (tokenOverride === "") toast.success("Token entfernt");
      else toast.success(draft.enabled ? "Gespeichert – Bridge läuft" : "Gespeichert");
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function removeToken() {
    const ok = await confirm({
      title: "Token entfernen?",
      description: "Der Bot-Token wird vom Server gelöscht. Die Bridge läuft erst wieder, wenn du einen neuen Token einträgst.",
      confirmLabel: "Entfernen",
      tone: "danger",
    });
    if (ok) await save("");
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
      if (d.ok) toast.success("Verbindung funktioniert", { description: d.username ? `Bot @${d.username}` : undefined });
      else toast.error(`Verbindung fehlgeschlagen: ${d.error || "Token ungültig"}`);
    } catch {
      toast.error("Verbindung fehlgeschlagen: Server nicht erreichbar");
    } finally {
      setTesting(false);
    }
  }

  const statusPill = status?.running ? (
    <Badge variant="success" icon={<Check aria-hidden />}>
      aktiv{status.botUsername ? ` · @${status.botUsername}` : ""}
    </Badge>
  ) : status ? (
    <Badge variant="neutral">inaktiv</Badge>
  ) : null;

  const workspaceOptions = [
    // Empty = the server's first allowed folder (resolveWorkdir default).
    { value: "", label: "Standard", description: "erster erlaubter Projektordner des Servers" },
    ...workspaces.map((w) => ({ value: w.path, label: w.label, description: w.label !== w.path ? w.path : undefined })),
    // Keep a saved folder selectable even when it is not in the list (anymore).
    ...(draft.cwd && !workspaces.some((w) => w.path === draft.cwd) ? [{ value: draft.cwd, label: draft.cwd }] : []),
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Telegram"
        meta={statusPill}
        description={
          <>
            Die PWA bleibt primär (über Tailscale). Wenn du nicht im Tailscale bist, kannst du den Assistenten optional per
            Telegram steuern. Kein Zwang – aktivieren nur, wenn gewünscht. Bot-Token über <Code>@BotFather</Code> erstellen.
          </>
        }
      />

      {loadFailed && !config ? (
        <Callout
          variant="danger"
          title="Telegram-Einstellungen konnten nicht geladen werden"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Erneut versuchen
            </Button>
          }
        />
      ) : null}

      {status?.error ? (
        <Callout variant="danger" title="Fehler der Bridge">
          {status.error}
        </Callout>
      ) : null}

      {!config && !loadFailed ? (
        <SettingsCard aria-busy>
          <span className="sr-only" role="status">
            Einstellungen werden geladen …
          </span>
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-10 w-full md:h-8" />
            <Skeleton className="h-10 w-full md:h-8" />
          </div>
        </SettingsCard>
      ) : null}

      {config ? (
        <>
          <SettingsCard title="Bridge" icon={<Send />}>
            <div className="flex flex-col divide-y divide-border">
              <SwitchRow
                label="Telegram-Bridge aktivieren"
                description="Startet den Bot beim Speichern; aus = Bot gestoppt."
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
              />
              <SwitchRow
                label="Wissensbasis in Antworten einbeziehen"
                checked={draft.useKnowledge}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, useKnowledge: v }))}
              />
            </div>
          </SettingsCard>

          <SettingsCard title="Zugang">
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel>Bot-Token</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <SecretInput
                    groupClassName="sm:flex-1"
                    placeholder={config.hasToken ? `gespeichert (${config.tokenMasked}) – leer lassen zum Behalten` : "123456:AA…"}
                    revealLabel="Token anzeigen"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <Button variant="outline" loading={testing} onClick={() => void testTokenNow()}>
                    Token testen
                  </Button>
                </div>
                {config.hasToken ? (
                  <FieldHint>Ein neuer Token ersetzt den gespeicherten beim Speichern.</FieldHint>
                ) : null}
              </Field>
              {config.hasToken ? (
                <Button variant="danger-ghost" className="self-start" disabled={saving} onClick={() => void removeToken()}>
                  <Trash2 />
                  Token entfernen
                </Button>
              ) : null}

              <Field>
                <FieldLabel>Erlaubte Chat-IDs</FieldLabel>
                <Input
                  // No numeric keypad: group ids are negative and lists need commas.
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="z. B. 123456789, -1001234567890"
                  value={chatIds}
                  onChange={(e) => setChatIds(e.target.value)}
                />
                <FieldHint>
                  Nur diese Telegram-Chats dürfen den Bot steuern. Schreib dem Bot <Code>/whoami</Code>, um deine ID zu
                  erfahren.
                </FieldHint>
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard title="Sessions aus Telegram" description="So starten Läufe, die per Telegram kommen.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel>Arbeitsverzeichnis</FieldLabel>
                <SimpleSelect
                  options={workspaceOptions}
                  value={draft.cwd}
                  onValueChange={(v) => setDraft((d) => ({ ...d, cwd: v }))}
                  placeholder="Ordner wählen"
                />
              </Field>
              <Field>
                <FieldLabel>Agent</FieldLabel>
                <SimpleSelect
                  options={PROVIDERS.map((p) => ({ value: p, label: providerLabel(p) }))}
                  value={draft.provider}
                  onValueChange={(v) => setDraft((d) => ({ ...d, provider: v }))}
                />
              </Field>
              <Field>
                <FieldLabel optional="optional">Modell</FieldLabel>
                <Input
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="leer = Standard"
                  value={draft.model}
                  onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                />
              </Field>
              <Field>
                <FieldLabel>Berechtigungen</FieldLabel>
                <SimpleSelect
                  options={PERMISSION_MODES.map((m) => ({ value: m, label: permissionModeLabel(m) }))}
                  value={draft.permissionMode}
                  onValueChange={(v) => setDraft((d) => ({ ...d, permissionMode: v }))}
                />
              </Field>
              <Field>
                <FieldLabel>Freigabe</FieldLabel>
                <SimpleSelect
                  options={APPROVAL_MODES.map((m) => ({ value: m, label: approvalModeLabel(m) }))}
                  value={draft.approvalMode}
                  onValueChange={(v) => setDraft((d) => ({ ...d, approvalMode: v }))}
                />
                {/* The bridge drops a gate the agent cannot enforce (and says so in the chat). */}
                {draft.approvalMode !== "off" && !APPROVAL_CAPABLE.has(draft.provider) ? (
                  <FieldHint>Gilt nur für Claude Code und pi – {providerLabel(draft.provider)} läuft ohne Freigabe-Gate.</FieldHint>
                ) : null}
              </Field>
            </div>
            {draft.permissionMode === "bypassPermissions" ? (
              <Callout variant="warning" className="mt-4">
                Ohne Rückfrage führt der Agent Befehle aus, ohne dich zu fragen – auch wenn du über Telegram nicht erreichbar
                bist.
              </Callout>
            ) : null}
          </SettingsCard>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Speichern & anwenden
            </Button>
            {status ? (
              <span className="text-sm text-muted-foreground md:text-ui" aria-live="polite">
                {status.running ? `Bridge läuft (${status.boundChats} ${status.boundChats === 1 ? "Chat" : "Chats"})` : "Bridge gestoppt"}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
