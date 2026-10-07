"use client";

import { Brain, Check, Cpu, Eye, Loader2, MessageSquareText, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  PiInstallHint, SMALL_CONTEXT, formatContext, sortPiModels, usePiStatus, type PiModel,
} from "@/components/assistant/pi-status";

const CODE = "px-1 bg-accent rounded";
const BADGE = "text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 whitespace-nowrap";

function ModelBadges({ model }: { model: PiModel }) {
  const small = model.contextWindow > 0 && model.contextWindow < SMALL_CONTEXT;
  return (
    <div className="flex flex-wrap gap-1">
      {model.toolsOk ? (
        <span className={`${BADGE} bg-green-500/15 text-green-600 dark:text-green-400`} title="Unterstützt Tool-Aufrufe">
          <Wrench size={10} /> Tools ✓ · kann Dateien bearbeiten
        </span>
      ) : (
        <span className={`${BADGE} bg-accent text-muted-foreground`} title="Keine Tool-Unterstützung — antwortet nur in Text">
          <MessageSquareText size={10} /> Tools ✗ · nur Text
        </span>
      )}
      {model.reasoning && (
        <span className={`${BADGE} bg-violet-500/15 text-violet-600 dark:text-violet-400`}>
          <Brain size={10} /> Thinking
        </span>
      )}
      {model.vision && (
        <span className={`${BADGE} bg-sky-500/15 text-sky-600 dark:text-sky-400`}>
          <Eye size={10} /> Vision
        </span>
      )}
      <span
        className={`${BADGE} ${small ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-accent text-muted-foreground"}`}
        title={small ? "Wenig Kontext — für Agenten-Arbeit mindestens 64k empfohlen" : "Wirksamer Kontext auf dem KI-Server"}
      >
        Kontext {formatContext(model.contextWindow)}
      </span>
    </div>
  );
}

export function PiSettings() {
  const { status, error, loading, refresh } = usePiStatus(true);
  const models = status ? sortPiModels(status.models) : [];
  const editing = models.filter((m) => m.toolsOk).length;

  async function resync() {
    const s = await refresh(true);
    if (!s) toast.error("Synchronisieren fehlgeschlagen.");
    else if (s.error) toast.error(`Synchronisiert mit Fehler: ${s.error}`);
    else toast.success(`${s.models.length} Modell(e) synchronisiert.`);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Cpu size={18} className="text-primary" />
        <h2 className="text-lg font-semibold">Lokale Modelle (pi)</h2>
        {status?.installed ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-500 flex items-center gap-1">
            <Check size={11} /> installiert{status.version ? ` · v${status.version.replace(/^v/, "")}` : ""}
          </span>
        ) : status ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent text-muted-foreground">nicht installiert</span>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Der Coding-Agent <a href="https://pi.dev" target="_blank" rel="noreferrer" className="underline hover:text-foreground">pi</a> macht
        jedes Modell auf deinem lokalen KI-Server (Ollama) im Code-Assistant nutzbar — inklusive Dateien lesen und bearbeiten
        sowie Befehle ausführen. Wähle dazu beim Anlegen einer Session den Provider <span className="font-medium">pi · lokale Modelle</span>.
      </p>

      {!status && !error && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Lade Status …
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {status && !status.installed && <PiInstallHint hint={status.installHint} />}

      {status && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            KI-Server (Ollama):{" "}
            {status.ollamaBaseUrl ? <code className={CODE}>{status.ollamaBaseUrl}</code> : "—"}
            {" "}· über <code className={CODE}>OLLAMA_BASE_URL</code> in der .env änderbar
          </p>
          {status.contextFallback > 0 && (
            <p>
              Kontext für Modelle ohne <code className={CODE}>num_ctx</code>: {formatContext(status.contextFallback)} · muss zum{" "}
              <code className={CODE}>OLLAMA_CONTEXT_LENGTH</code> des KI-Servers passen (sonst{" "}
              <code className={CODE}>PI_OLLAMA_CONTEXT_LENGTH</code> setzen)
            </p>
          )}
          {status.installed && status.bin && (
            <p className="truncate" title={status.bin}>Programm: <code className={CODE}>{status.bin}</code></p>
          )}
          {status.agentDir && (
            <p className="truncate" title={status.agentDir}>Konfiguration: <code className={CODE}>{status.agentDir}</code></p>
          )}
        </div>
      )}

      {status?.error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Synchronisierung: {status.error}</p>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">
            Synchronisierte Modelle{status ? ` (${models.length}${models.length ? `, ${editing} mit Datei-Edit` : ""})` : ""}
          </h3>
          <button
            onClick={resync}
            disabled={loading}
            className="ml-auto px-3 py-1.5 text-sm rounded-md border border-input hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Neu synchronisieren
          </button>
        </div>

        {status && models.length === 0 && (
          <p className="text-xs text-muted-foreground rounded-md border border-border p-3">
            Keine Modelle gefunden. Läuft Ollama unter der Adresse oben? Modelle mit{" "}
            <code className={CODE}>ollama pull &lt;modell&gt;</code> laden und dann neu synchronisieren.
          </p>
        )}

        {models.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {models.map((m) => (
              <li key={m.id} className="px-3 py-2 space-y-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-medium truncate" title={m.name}>{m.name}</span>
                  {m.name !== m.id && (
                    <code className="text-[11px] text-muted-foreground truncate" title={m.id}>{m.id}</code>
                  )}
                </div>
                <ModelBadges model={m} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-border bg-accent/30 p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">So funktioniert es</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>
            Jedes Modell auf dem KI-Server wird automatisch für pi registriert — neue Modelle nach{" "}
            <code className={CODE}>ollama pull</code> erscheinen nach „Neu synchronisieren“.
          </li>
          <li>
            Nur Modelle mit Tool-Unterstützung können Dateien lesen und bearbeiten oder Befehle ausführen. Modelle ohne
            Tools antworten nur in Text.
          </li>
          <li>
            Der Kontext ist der, mit dem Ollama das Modell tatsächlich lädt (<code className={CODE}>OLLAMA_CONTEXT_LENGTH</code>{" "}
            bzw. <code className={CODE}>num_ctx</code>). Für Agenten-Arbeit sind mindestens 64k empfehlenswert.
          </li>
          <li>Das Freigabe-Gate (Diff/Befehl bestätigen) funktioniert auch mit pi; die Sandbox gibt es nur mit Claude Code.</li>
          <li>
            CodeMaestro nutzt ein eigenes pi-Konfigurationsverzeichnis — dein <code className={CODE}>~/.pi</code> bleibt
            unberührt.
          </li>
        </ul>
      </div>
    </section>
  );
}
