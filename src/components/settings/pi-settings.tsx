"use client";

import { useEffect } from "react";
import { Brain, Check, Cpu, Eye, MessageSquareText, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PiInstallHint, SMALL_CONTEXT, formatContext, sortPiModels, usePiStatus, type PiModel,
} from "@/components/assistant/pi-status";
import { publishPiHint } from "./settings-hints";
import { Code, InfoRows, SectionHeader, SettingsCard } from "./settings-ui";

function ModelBadges({ model }: { model: PiModel }) {
  const small = model.contextWindow > 0 && model.contextWindow < SMALL_CONTEXT;
  return (
    <div className="flex flex-wrap gap-1">
      {model.toolsOk ? (
        <Badge variant="success" icon={<Wrench aria-hidden />} title="Unterstützt Tool-Aufrufe">
          Tools ✓ · kann Dateien bearbeiten
        </Badge>
      ) : (
        <Badge variant="neutral" icon={<MessageSquareText aria-hidden />} title="Keine Tool-Unterstützung – antwortet nur in Text">
          Tools ✗ · nur Text
        </Badge>
      )}
      {model.reasoning ? (
        <Badge variant="brand" icon={<Brain aria-hidden />}>
          Thinking
        </Badge>
      ) : null}
      {model.vision ? (
        <Badge variant="info" icon={<Eye aria-hidden />}>
          Vision
        </Badge>
      ) : null}
      <Badge
        variant={small ? "warning" : "neutral"}
        title={small ? "Wenig Kontext – für Agenten-Arbeit mindestens 64k empfohlen" : "Wirksamer Kontext auf dem KI-Server"}
      >
        Kontext {formatContext(model.contextWindow)}
        {small ? <span className="sr-only"> (wenig Kontext, mindestens 64k empfohlen)</span> : null}
      </Badge>
    </div>
  );
}

export function PiSettings() {
  const { status, error, loading, refresh } = usePiStatus(true);
  const models = status ? sortPiModels(status.models) : [];
  const editing = models.filter((m) => m.toolsOk).length;

  useEffect(() => {
    if (status) publishPiHint({ installed: status.installed, error: status.error });
  }, [status]);

  async function resync() {
    const s = await refresh(true);
    if (!s) toast.error("Synchronisieren fehlgeschlagen.");
    else if (s.error) toast.error(`Synchronisiert mit Fehler: ${s.error}`);
    else toast.success(s.models.length === 1 ? "1 Modell synchronisiert." : `${s.models.length} Modelle synchronisiert.`);
  }

  const statusBadge = status?.installed ? (
    <Badge variant="success" icon={<Check aria-hidden />}>
      installiert{status.version ? ` · v${status.version.replace(/^v/, "")}` : ""}
    </Badge>
  ) : status ? (
    <Badge variant="warning">nicht installiert</Badge>
  ) : null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Lokale Agenten (pi)"
        meta={statusBadge}
        description={
          <>
            Der Coding-Agent{" "}
            <a href="https://pi.dev" target="_blank" rel="noreferrer" className="text-primary-text underline decoration-primary-text/40 underline-offset-2 hover:decoration-primary-text">
              pi
            </a>{" "}
            macht jedes Modell auf deinem lokalen KI-Server (Ollama) im Assistenten nutzbar – inklusive Dateien lesen und
            bearbeiten sowie Befehle ausführen. Wähle dazu beim Anlegen einer Session den Agenten{" "}
            <span className="font-medium text-foreground">pi · lokale Modelle</span>.
          </>
        }
      />

      {!status && !error ? (
        <SettingsCard aria-busy>
          <span className="sr-only" role="status">
            Status wird geladen …
          </span>
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </SettingsCard>
      ) : null}

      {error ? (
        <Callout
          variant="danger"
          title="Status konnte nicht geladen werden"
          action={
            <Button variant="outline" loading={loading} onClick={() => void refresh(false)}>
              Erneut versuchen
            </Button>
          }
        >
          {error}
        </Callout>
      ) : null}

      {status && !status.installed ? <PiInstallHint hint={status.installHint} /> : null}

      {status ? (
        <SettingsCard title="KI-Server" icon={<Cpu />}>
          <InfoRows
            rows={[
              {
                label: "Ollama",
                value: (
                  <>
                    {status.ollamaBaseUrl ? <Code>{status.ollamaBaseUrl}</Code> : "–"}
                    <span className="block text-xs text-muted-foreground">
                      über <Code>OLLAMA_BASE_URL</Code> in der .env änderbar
                    </span>
                  </>
                ),
              },
              ...(status.contextFallback > 0
                ? [
                    {
                      label: "Standard-Kontext",
                      value: (
                        <>
                          {formatContext(status.contextFallback)} für Modelle ohne <Code>num_ctx</Code>
                          <span className="block text-xs text-muted-foreground">
                            muss zum <Code>OLLAMA_CONTEXT_LENGTH</Code> des KI-Servers passen (sonst{" "}
                            <Code>PI_OLLAMA_CONTEXT_LENGTH</Code> setzen)
                          </span>
                        </>
                      ),
                    },
                  ]
                : []),
              ...(status.installed && status.bin
                ? [{ label: "Programm", value: <span className="block truncate font-mono text-xs" title={status.bin}>{status.bin}</span> }]
                : []),
              ...(status.agentDir
                ? [{ label: "Konfiguration", value: <span className="block truncate font-mono text-xs" title={status.agentDir}>{status.agentDir}</span> }]
                : []),
            ]}
          />
        </SettingsCard>
      ) : null}

      {status?.error ? (
        <Callout variant="warning" title="Synchronisierung">
          {status.error}
        </Callout>
      ) : null}

      {status || error ? (
        <SettingsCard
          title="Synchronisierte Modelle"
          description={status ? `${models.length} ${models.length === 1 ? "Modell" : "Modelle"}${models.length ? `, ${editing} mit Datei-Edit` : ""}` : undefined}
          badge={
            <Button variant="outline" loading={loading} onClick={() => void resync()}>
              <RefreshCw />
              Neu synchronisieren
            </Button>
          }
          bodyClassName={models.length > 0 ? "p-0" : undefined}
        >
          {status && models.length === 0 ? (
            <p className="text-sm text-muted-foreground md:text-ui">
              Keine Modelle gefunden. Läuft Ollama unter der Adresse oben? Modelle mit <Code>ollama pull &lt;modell&gt;</Code>{" "}
              laden und dann neu synchronisieren.
            </p>
          ) : null}
          {models.length > 0 ? (
            <ul className="divide-y divide-border">
              {models.map((m) => (
                <li key={m.id} className="space-y-1.5 px-4 py-2.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium md:text-ui" title={m.name}>
                      {m.name}
                    </span>
                    {m.name !== m.id ? (
                      <code className="truncate font-mono text-xs text-muted-foreground" title={m.id}>
                        {m.id}
                      </code>
                    ) : null}
                  </div>
                  <ModelBadges model={m} />
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsCard>
      ) : null}

      <details className="group rounded-lg border border-border bg-card text-sm md:text-ui">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 font-medium text-foreground marker:hidden md:min-h-10 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-subtle-foreground transition-transform group-open:rotate-90">›</span>
          So funktioniert es
        </summary>
        <ul className="list-disc space-y-1.5 border-t border-border py-3 pl-9 pr-4 text-muted-foreground">
          <li>
            Jedes Modell auf dem KI-Server wird automatisch für pi registriert – neue Modelle nach <Code>ollama pull</Code>{" "}
            erscheinen nach „Neu synchronisieren“.
          </li>
          <li>
            Nur Modelle mit Tool-Unterstützung können Dateien lesen und bearbeiten oder Befehle ausführen. Modelle ohne Tools
            antworten nur in Text.
          </li>
          <li>
            Der Kontext ist der, mit dem Ollama das Modell tatsächlich lädt (<Code>OLLAMA_CONTEXT_LENGTH</Code> bzw.{" "}
            <Code>num_ctx</Code>). Für Agenten-Arbeit sind mindestens 64k empfehlenswert.
          </li>
          <li>Die Freigabe (Diff/Befehl bestätigen) funktioniert auch mit pi; die Sandbox gibt es nur mit Claude Code.</li>
          <li>
            CodeMaestro nutzt ein eigenes pi-Konfigurationsverzeichnis – dein <Code>~/.pi</Code> bleibt unberührt.
          </li>
        </ul>
      </details>
    </div>
  );
}
