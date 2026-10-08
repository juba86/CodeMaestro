"use client";

import { useId, useState } from "react";
import { Check, ChevronUp, ExternalLink, X } from "lucide-react";
import type { ProviderDef } from "@/lib/ai/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ProviderMark, providerTone } from "@/components/ui/provider-mark";
import { SecretInput } from "@/components/ui/secret-input";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import {
  PROVIDER_LIST,
  isOllama,
  keyRequired,
  providerSummaryText,
  supportsLogin,
} from "./provider-status";
import { Code, SectionHeader } from "./settings-ui";
import type { ProviderSetup } from "./use-provider-setup";

const LOGIN_LABEL: Record<string, string> = { claude: "Login (Claude Code)", gemini: "Google-Login" };
const OLLAMA_URL = process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434";

function ProviderBadges({ def, setup }: { def: ProviderDef; setup: ProviderSetup }) {
  const result = setup.validationResults[def.id];
  return (
    <>
      {def.local ? <Badge variant="neutral">lokal</Badge> : null}
      {!keyRequired(def) && !def.local && def.keyOptional ? <Badge variant="neutral">Key optional</Badge> : null}
      {setup.activeProvider === def.id ? <Badge variant="brand">aktiv</Badge> : null}
      {result === true ? (
        <Badge variant="success" icon={<Check aria-hidden />}>
          geprüft
        </Badge>
      ) : result === false ? (
        <Badge variant="danger" icon={<X aria-hidden />}>
          fehlgeschlagen
        </Badge>
      ) : null}
    </>
  );
}

function ProviderBody({ def, setup }: { def: ProviderDef; setup: ProviderSetup }) {
  const login = supportsLogin(def);
  const loginId = def.id as "claude" | "gemini";
  const oauth = login && setup.authModes[loginId] === "oauth";
  const required = keyRequired(def);
  const busy = setup.validating === def.id;
  const key = setup.apiKeys[def.id] || "";

  return (
    <div className="flex flex-col gap-3">
      {login ? (
        <SegmentedControl
          aria-label={`Anmeldung für ${def.label}`}
          value={setup.authModes[loginId]}
          onValueChange={(m) => void setup.changeAuthMode(loginId, m as "key" | "oauth")}
          className="self-start"
        >
          <SegmentedItem value="key">API-Key</SegmentedItem>
          <SegmentedItem value="oauth">{LOGIN_LABEL[def.id]}</SegmentedItem>
        </SegmentedControl>
      ) : null}

      {def.configurableBaseUrl ? (
        <Field>
          <FieldLabel>Base-URL</FieldLabel>
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="z. B. http://localhost:8000/v1"
            value={setup.baseUrls[def.id] || ""}
            onChange={(e) => setup.handleBaseChange(def.id, e.target.value)}
          />
          {def.docs && !def.docs.startsWith("http") ? <FieldHint>{def.docs}</FieldHint> : null}
        </Field>
      ) : null}

      {oauth ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground md:text-ui">
            {def.id === "claude" ? (
              <>
                Nutzt den Login der <Code>claude</Code>-CLI auf dem Server (Claude Code, kein API-Key). Dort einmalig{" "}
                <Code>claude</Code> starten und einloggen.
              </>
            ) : (
              <>
                Nutzt den Google-Login der <Code>gemini</Code>-CLI auf dem Server (kein API-Key). Dort einmalig{" "}
                <Code>gemini</Code> ausführen und „Login with Google“ wählen.
              </>
            )}
          </p>
          <Button variant="outline" className="self-start" loading={busy} onClick={() => void setup.validateKey(def.id)}>
            Verbindung testen
          </Button>
        </div>
      ) : isOllama(def) ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground md:text-ui">
            Kein API-Key nötig. Verbindet sich mit <Code>{OLLAMA_URL}</Code>. Installierte Modelle erscheinen unter
            „Standardmodell“, sobald Ollama der aktive Provider ist.
          </p>
          <Button variant="outline" className="self-start" loading={busy} onClick={() => void setup.validateKey(def.id)}>
            Verbindung testen
          </Button>
        </div>
      ) : (
        <Field>
          <FieldLabel optional={required ? undefined : "optional"}>API-Key</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SecretInput
              groupClassName="sm:flex-1"
              placeholder={`${def.label} API-Key`}
              revealLabel="Key anzeigen"
              value={key}
              onChange={(e) => setup.handleKeyChange(def.id, e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => void setup.saveKey(def.id)}>
                Speichern
              </Button>
              <Button
                variant="primary"
                className="flex-1 sm:flex-none"
                loading={busy}
                disabledReason={required && !key.trim() ? "Erst einen Key eingeben" : undefined}
                onClick={() => void setup.validateKey(def.id)}
              >
                Prüfen
              </Button>
            </div>
          </div>
          {def.docs ? (
            <FieldHint>
              {def.envKeys?.length ? (
                <>
                  Oder <Code>{def.envKeys[0]}</Code> in der .env des Servers setzen.{" "}
                </>
              ) : null}
              {def.docs.startsWith("http") ? (
                <a
                  href={def.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary-text underline decoration-primary-text/40 underline-offset-2 hover:decoration-primary-text"
                >
                  Key holen
                  <ExternalLink aria-hidden className="size-3" />
                  <span className="sr-only">(öffnet in neuem Tab)</span>
                </a>
              ) : null}
            </FieldHint>
          ) : null}
        </Field>
      )}
    </div>
  );
}

function ConfiguredCard({ def, setup }: { def: ProviderDef; setup: ProviderSetup }) {
  return (
    <Card asChild>
      <li>
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <ProviderMark tone={providerTone(def.id)} label={def.label} className="text-sm font-medium text-foreground md:text-ui" />
          <ProviderBadges def={def} setup={setup} />
        </div>
        <div className="p-4">
          <ProviderBody def={def} setup={setup} />
        </div>
      </li>
    </Card>
  );
}

function CompactRow({ def, setup, expanded, onToggle }: { def: ProviderDef; setup: ProviderSetup; expanded: boolean; onToggle: () => void }) {
  const bodyId = useId();
  return (
    <li>
      <div className="flex min-h-12 items-center gap-2 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ProviderMark tone={providerTone(def.id)} label={def.label} className="text-sm text-foreground md:text-ui" />
          <ProviderBadges def={def} setup={setup} />
        </div>
        <Button
          variant={expanded ? "ghost" : "outline"}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={expanded ? `${def.label} einklappen` : `${def.label} einrichten`}
          onClick={onToggle}
        >
          {expanded ? (
            <>
              <ChevronUp />
              Schließen
            </>
          ) : (
            "Einrichten"
          )}
        </Button>
      </div>
      <div id={bodyId} hidden={!expanded} className="border-t border-border bg-surface/50 px-4 py-4">
        {expanded ? <ProviderBody def={def} setup={setup} /> : null}
      </div>
    </li>
  );
}

export function ProvidersSection({ setup }: { setup: ProviderSetup }) {
  const [filter, setFilter] = useState<"configured" | "all">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const configuredIds = new Set(setup.summary.ids);
  // Under „Alle" a row being set up stays where it is (typing a base URL or
  // saving a key must not move it away under the cursor); it joins the cards
  // once closed. „Eingerichtet" shows every configured provider as a card.
  const keepInRow = (id: string) => filter === "all" && Boolean(expanded[id]);
  const configured = PROVIDER_LIST.filter((p) => configuredIds.has(p.id) && !keepInRow(p.id));
  const others = PROVIDER_LIST.filter((p) => !configuredIds.has(p.id) || keepInRow(p.id));

  return (
    <div>
      <SectionHeader
        title="Provider"
        description="Zugänge für Builder, Playground und die API-Modelle im Orchester. API-Keys werden nur in diesem Browser gespeichert."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground md:text-ui" aria-live="polite">
          {providerSummaryText(setup.summary)}
        </p>
        <SegmentedControl aria-label="Provider anzeigen" value={filter} onValueChange={(v) => setFilter(v as "configured" | "all")}>
          <SegmentedItem value="configured">Eingerichtet</SegmentedItem>
          <SegmentedItem value="all">Alle</SegmentedItem>
        </SegmentedControl>
      </div>

      {configured.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Eingerichtete Provider">
          {configured.map((p) => (
            <ConfiguredCard key={p.id} def={p} setup={setup} />
          ))}
        </ul>
      ) : filter === "configured" ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted-foreground md:text-ui">
          Noch kein Provider eingerichtet. Unter „Alle“ kannst du einen einrichten.
        </p>
      ) : null}

      {filter === "all" && others.length > 0 ? (
        <section className={cn(configured.length > 0 && "mt-6")} aria-labelledby="providers-more">
          <h3 id="providers-more" className="mb-2 text-xs font-medium text-subtle-foreground">
            {configured.length > 0 ? "Weitere Provider" : "Alle Provider"}
          </h3>
          <Card asChild>
            <ul className="divide-y divide-border overflow-hidden">
              {others.map((p) => (
                <CompactRow
                  key={p.id}
                  def={p}
                  setup={setup}
                  expanded={Boolean(expanded[p.id])}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
