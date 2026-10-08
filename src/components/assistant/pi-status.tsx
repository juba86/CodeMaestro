"use client";

import { useCallback, useEffect, useState } from "react";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";

// Client side of GET/POST /api/assistant/pi: whether the pi coding agent is
// installed and which local Ollama models CodeMaestro registered for it. Shared
// by the settings section and the Code Assistant's new-session form.

export interface PiModel {
  id: string;
  name: string;
  /** Model supports tool calls → it can read/edit files and run commands. */
  toolsOk: boolean;
  reasoning: boolean;
  vision: boolean;
  /** Effective runtime context in tokens (0 = unknown). */
  contextWindow: number;
}

export interface PiStatus {
  installed: boolean;
  version: string;
  bin: string;
  agentDir: string;
  ollamaBaseUrl: string;
  /** Context assumed for models without a Modelfile num_ctx (0 = unknown). */
  contextFallback: number;
  models: PiModel[];
  error: string;
  installHint: string;
}

export const PI_PROVIDER_LABEL = "pi · lokale Modelle";
const DEFAULT_INSTALL_HINT = "npm install -g --ignore-scripts @earendil-works/pi-coding-agent";

const str = (v: unknown) => (typeof v === "string" ? v : "");

// The route is the contract, but parse defensively: a half-filled payload must
// render as "unknown", never crash the settings page or the session form.
function normalize(d: Record<string, unknown>): PiStatus {
  const models = Array.isArray(d.models) ? d.models : [];
  return {
    installed: d.installed === true,
    version: str(d.version),
    bin: str(d.bin),
    agentDir: str(d.agentDir),
    ollamaBaseUrl: str(d.ollamaBaseUrl),
    contextFallback: typeof d.contextFallback === "number" && d.contextFallback > 0 ? d.contextFallback : 0,
    error: str(d.error),
    installHint: str(d.installHint) || DEFAULT_INSTALL_HINT,
    models: models
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string")
      .map((m) => ({
        id: m.id as string,
        name: str(m.name) || (m.id as string),
        toolsOk: m.toolsOk === true,
        reasoning: m.reasoning === true,
        vision: m.vision === true,
        contextWindow: typeof m.contextWindow === "number" && m.contextWindow > 0 ? m.contextWindow : 0,
      })),
  };
}

/** GET the status, or POST `{force:true}` to re-read the models from Ollama first. */
export async function fetchPiStatus(force = false): Promise<PiStatus> {
  let res: Response;
  try {
    res = force
      ? await fetch("/api/assistant/pi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        })
      : await fetch("/api/assistant/pi", { cache: "no-store" });
  } catch {
    throw new Error("Server nicht erreichbar.");
  }
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // A failed sync still reports install state + the last known models.
  if (d && typeof d.installed === "boolean") return normalize(d);
  throw new Error(str(d?.error) || `Fehler ${res.status}`);
}

/** Tool-capable (file-editing) models first, then by name. */
export function sortPiModels(models: PiModel[]): PiModel[] {
  return [...models].sort((a, b) => Number(b.toolsOk) - Number(a.toolsOk) || a.name.localeCompare(b.name, "de"));
}

/** 32768 → "32k", 128000 → "128k" (Ollama mixes binary and decimal sizes). */
export function formatContext(tokens: number): string {
  if (!tokens) return "?";
  if (tokens < 1000) return String(tokens);
  return `${tokens % 1000 !== 0 && tokens % 1024 === 0 ? tokens / 1024 : Math.round(tokens / 1000)}k`;
}

/** Below this the agent loop (system prompt, tool schemas, file contents) barely fits. */
export const SMALL_CONTEXT = 16_384;

/**
 * Loads the pi status once `enabled` turns true; `refresh(true)` re-syncs the
 * model list from the AI server. A failed load is not retried automatically.
 */
export function usePiStatus(enabled: boolean) {
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const needed = enabled && status === null && !error;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    fetchPiStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Status konnte nicht geladen werden."); });
    return () => { cancelled = true; };
  }, [needed]);

  const refresh = useCallback(async (force = true): Promise<PiStatus | null> => {
    setRefreshing(true);
    try {
      const s = await fetchPiStatus(force);
      setStatus(s);
      setError("");
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status konnte nicht geladen werden.");
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { status, error, loading: needed || refreshing, refresh };
}

/** "pi is not installed" box with the install command and a copy button. */
export function PiInstallHint({ hint, compact = false }: { hint: string; compact?: boolean }) {
  const command = hint || DEFAULT_INSTALL_HINT;
  return (
    <Callout variant="warning" title="pi ist auf dem Server nicht installiert." className={compact ? "p-2.5" : undefined}>
      <p className="text-ui text-muted-foreground">Auf dem Server ausführen (benötigt Node ≥ 22.19):</p>
      <CodeBlock code={command} wrap copyLabel="Installationsbefehl kopieren" className="mt-1.5" />
    </Callout>
  );
}
