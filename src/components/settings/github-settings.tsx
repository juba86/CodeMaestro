"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Check, Copy, ExternalLink, Github, Info, KeyRound, LoaderCircle, Lock, Plug, Unplug, X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { confirm } from "@/components/ui/confirm";
import { useCopy } from "@/components/ui/copy-text";
import { Countdown } from "@/components/ui/countdown";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchRow } from "@/components/ui/switch";
import { publishGithubHint } from "./settings-hints";
import { Code, InfoRows, SectionHeader, SettingsCard } from "./settings-ui";

interface GithubStatus {
  connected: boolean;
  tokenReadable: boolean;
  method: "device" | "token" | null;
  tokenKind: "classic" | "fine-grained" | "oauth" | "app" | "unknown" | null;
  login: string | null;
  name: string | null;
  id: number | null;
  avatarUrl: string | null;
  email: string | null;
  profileUrl: string | null;
  commitEmail: string | null;
  scopes: string[];
  connectedAt: string | null;
  expiresAt: string | null;
  autoRefresh: boolean;
  warnings: string[];
  injectIntoAssistant: boolean;
  gitIdentity: boolean;
  oauthClientId: string;
  envClientId: boolean;
}

interface DeviceFlow {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

interface RepoCheck {
  fullName: string;
  private: boolean;
  push: boolean;
  url: string;
}

type FlowOutcome = "expired" | "denied" | null;

const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=CodeMaestro";
const FINE_GRAINED_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=CodeMaestro&description=Push%20aus%20dem%20CodeMaestro-Assistant&contents=write&pull_requests=write&workflows=write";
const NEW_OAUTH_APP_URL = "https://github.com/settings/applications/new";

const METHOD_LABEL: Record<string, string> = { device: "GitHub-Anmeldung", token: "Personal Access Token" };
const KIND_LABEL: Record<string, string> = {
  classic: "klassisch",
  "fine-grained": "fein-granular",
  oauth: "OAuth-App",
  app: "GitHub-App",
  unknown: "unbekannt",
};
const NO_CLIENT_REASON = "Für die Anmeldung per Code braucht der Server eine GitHub-OAuth-App";
// getGithubStatus() also lists this one in warnings[]; the danger Callout replaces it.
const UNREADABLE_WARNING = /nicht entschlüsselt/;

function formatDay(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

/** "WDJB-MJHT" → "W D J B Bindestrich M J H T" for screen readers. */
function spellCode(code: string): string {
  return code
    .split("")
    .map((c) => (c === "-" ? "Bindestrich" : c))
    .join(" ");
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Server nicht erreichbar.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 text-primary-text underline decoration-primary-text/40 underline-offset-2 hover:decoration-primary-text", className)}
    >
      {children}
      <ExternalLink aria-hidden className="size-3 shrink-0" />
      <span className="sr-only">(öffnet in neuem Tab)</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Device flow: start, poll, cancel. The server enforces GitHub's interval, so
// the loop just follows the interval it reports back.
// ---------------------------------------------------------------------------

function useDeviceFlow(onConnected: (s: GithubStatus) => void) {
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<FlowOutcome>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (clientId: string) => {
    setStarting(true);
    setNote("");
    setOutcome(null);
    try {
      const d = await api<{ flowId: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }>(
        "/api/github/device/start",
        jsonInit("POST", { clientId: clientId.trim() || undefined }),
      );
      setFlow({ flowId: d.flowId, userCode: d.userCode, verificationUri: d.verificationUri, interval: d.interval, expiresAt: Date.now() + d.expiresIn * 1000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anmeldung konnte nicht gestartet werden.");
    } finally {
      setStarting(false);
    }
  }, []);

  const cancel = useCallback(() => {
    if (flow) void fetch("/api/github/device/poll", jsonInit("POST", { flowId: flow.flowId, cancel: true })).catch(() => {});
    setFlow(null);
    setNote("");
  }, [flow]);

  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let interval = flow.interval;
    let timer: ReturnType<typeof setTimeout>;
    const end = (next: FlowOutcome) => {
      setOutcome(next);
      setFlow(null);
      setNote("");
    };
    const tick = async () => {
      if (cancelled) return;
      // The server reports expiry itself; this only ends the loop when it
      // can't be reached anymore.
      if (Date.now() > flow.expiresAt + 10_000) {
        end("expired");
        return;
      }
      try {
        const res = await fetch("/api/github/device/poll", jsonInit("POST", { flowId: flow.flowId }));
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(d.error || "Abfrage fehlgeschlagen.");
          end(null);
          return;
        }
        if (typeof d.interval === "number" && d.interval > 0) interval = d.interval;
        if (d.status === "connected") {
          toast.success("GitHub verbunden");
          end(null);
          if (d.github) onConnected(d.github);
          return;
        }
        if (d.status === "pending" || d.status === "slow_down") {
          setNote(d.message || "");
        } else if (d.status === "expired") {
          end("expired");
          return;
        } else if (d.status === "denied") {
          end("denied");
          return;
        } else {
          toast.error(d.message || "Anmeldung fehlgeschlagen.");
          end(null);
          return;
        }
      } catch {
        if (cancelled) return;
        setNote("Server nicht erreichbar – neuer Versuch …");
      }
      timer = setTimeout(tick, interval * 1000 + 500);
    };
    timer = setTimeout(tick, interval * 1000 + 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow, onConnected]);

  return { flow, note, outcome, starting, start, cancel };
}

type DeviceFlowApi = ReturnType<typeof useDeviceFlow>;

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm text-foreground md:text-ui">
      <span
        aria-hidden
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
          done ? "bg-primary text-primary-foreground" : "border border-border-strong text-muted-foreground",
        )}
      >
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function DeviceFlowRunning({ device, onUseToken }: { device: DeviceFlowApi; onUseToken: () => void }) {
  const flow = device.flow!;
  const { copied, copy } = useCopy();
  const host = flow.verificationUri.replace(/^https?:\/\//, "");

  async function copyCode() {
    if (await copy(flow.userCode)) toast.success("Kopiert");
    else toast.error("Kopieren nicht möglich – bitte manuell abtippen.");
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <ol className="flex flex-col gap-3 md:pt-1" aria-label="So verbindest du dein Konto">
          <Step n={1} done>
            Öffne <ExtLink href={flow.verificationUri}>{host}</ExtLink>
          </Step>
          <Step n={2} done>
            Gib den Code ein
          </Step>
          <Step n={3}>Bestätige „CodeMaestro“ – diese Seite aktualisiert sich von selbst</Step>
        </ol>
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface-2 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">Dein Code</p>
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="select-all whitespace-nowrap font-mono text-3xl font-semibold tracking-[0.18em] text-foreground">
              {flow.userCode}
            </span>
            <span className="sr-only">{spellCode(flow.userCode)}</span>
            <IconButton aria-label={copied ? "Kopiert" : "Code kopieren"} onClick={() => void copyCode()}>
              {copied ? <Check className="text-success" /> : <Copy />}
            </IconButton>
          </div>
          <Countdown expiresAt={flow.expiresAt} label="gültig noch" totalMs={15 * 60_000} className="data-[phase=normal]:text-muted-foreground" />
        </div>
      </div>
      <p className="min-h-4 pt-2 text-xs text-muted-foreground" aria-live="polite">
        {device.note}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button asChild variant="primary" className="hidden md:inline-flex">
          <a href={flow.verificationUri} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            GitHub öffnen
            <span className="sr-only">(öffnet in neuem Tab)</span>
          </a>
        </Button>
        <Button asChild variant="primary" size="lg" className="w-full md:hidden">
          <a href={flow.verificationUri} target="_blank" rel="noreferrer" onClick={() => void copy(flow.userCode)}>
            <Copy aria-hidden />
            Code kopieren & GitHub öffnen
            <span className="sr-only">(öffnet in neuem Tab)</span>
          </a>
        </Button>
        <Button variant="ghost" onClick={device.cancel}>
          Abbrechen
        </Button>
        <Button variant="link" className="ml-auto" onClick={() => { device.cancel(); onUseToken(); }}>
          Stattdessen Token einfügen
        </Button>
      </div>
    </>
  );
}

function ClientIdField({ status, clientId, onChange }: { status: GithubStatus; clientId: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel optional={status.envClientId || status.oauthClientId ? "optional" : undefined}>OAuth-App-Client-ID</FieldLabel>
        <Input
          className="font-mono"
          placeholder={status.envClientId ? "leer = GITHUB_OAUTH_CLIENT_ID vom Server" : "z. B. Ov23li…"}
          value={clientId}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <FieldHint>Wird beim Start gespeichert. Ein Client-Secret wird nicht benötigt.</FieldHint>
      </Field>
      <details className="group text-sm text-muted-foreground md:text-ui">
        <summary className="cursor-pointer text-primary-text underline-offset-4 hover:underline">
          Wie bekomme ich eine Client-ID? (einmalig, ca. 1 Minute)
        </summary>
        <ol className="list-decimal space-y-1 pl-5 pt-2">
          <li>
            GitHub → Settings → Developer settings → OAuth Apps → <ExtLink href={NEW_OAUTH_APP_URL}>New OAuth App</ExtLink>.
          </li>
          <li>
            Name beliebig (z. B. „CodeMaestro“), Homepage-URL beliebig (z. B. <Code>http://localhost:3000</Code>). Die
            Callback-URL wird nicht verwendet – irgendeine gültige URL eintragen.
          </li>
          <li>
            <strong className="font-medium text-foreground">„Enable Device Flow“</strong> ankreuzen (beim Anlegen oder danach in
            den App-Einstellungen).
          </li>
          <li>Client-ID kopieren und hier eintragen.</li>
        </ol>
        <p className="pt-2">
          Angefragte Berechtigungen: <Code>repo</Code>, <Code>workflow</Code>, <Code>read:org</Code>.
        </p>
      </details>
    </div>
  );
}

function TokenPanel({ onConnected, primary = true }: { onConnected: (s: GithubStatus) => void; primary?: boolean }) {
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      const d = await api<{ status: GithubStatus }>("/api/github/token", jsonInit("POST", { token: token.trim() }));
      setToken("");
      onConnected(d.status);
      toast.success(`Verbunden als @${d.status.login}`);
    } catch (err) {
      toast.error(`Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : "unbekannter Fehler"}`);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel>Personal Access Token</FieldLabel>
        <SecretInput
          placeholder="ghp_… oder github_pat_…"
          revealLabel="Token anzeigen"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && token.trim() && !connecting) void connect();
          }}
        />
      </Field>
      <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 md:text-ui">
        <div className="space-y-1.5 rounded-lg border border-border bg-surface-2 p-3">
          <ExtLink href={FINE_GRAINED_TOKEN_URL} className="min-h-10 font-medium md:min-h-0">
            Fein-granularen Token erstellen
          </ExtLink>
          <p>Repositories auswählen, dann diese Berechtigungen (Bezeichnungen wie auf GitHub):</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              <span className="text-foreground">Contents</span>: „Read and write“ (lesen und schreiben)
            </li>
            <li>
              <span className="text-foreground">Pull requests</span>: „Read and write“
            </li>
            <li>
              <span className="text-foreground">Workflows</span>: „Read and write“ (für GitHub Actions)
            </li>
            <li>
              <span className="text-foreground">Metadata</span>: „Read-only“ (automatisch gesetzt)
            </li>
          </ul>
          <p className="text-xs">Gilt nur für einen Owner (Nutzer oder Organisation).</p>
        </div>
        <div className="space-y-1.5 rounded-lg border border-border bg-surface-2 p-3">
          <ExtLink href={CLASSIC_TOKEN_URL} className="min-h-10 font-medium md:min-h-0">
            Klassischen Token erstellen
          </ExtLink>
          <p>
            Scopes <Code>repo</Code> und <Code>workflow</Code> (optional <Code>read:org</Code>).
          </p>
          <p className="text-xs">
            Gilt für alle Repos, auf die du Zugriff hast – auch als Collaborator und über mehrere Organisationen.
          </p>
        </div>
      </div>
      <Button
        variant={primary ? "primary" : "outline"}
        className="self-start"
        loading={connecting}
        disabledReason={token.trim() ? undefined : "Erst einen Token einfügen"}
        onClick={() => void connect()}
      >
        <KeyRound />
        Prüfen & speichern
      </Button>
    </div>
  );
}

/** Not connected (or reconnecting): device flow, token paste and the client-id setup. */
function ConnectPanel({ status, device, onConnected }: { status: GithubStatus; device: DeviceFlowApi; onConnected: (s: GithubStatus) => void }) {
  const hasClient = status.envClientId || Boolean(status.oauthClientId);
  const [view, setView] = useState<"device" | "token">(hasClient ? "device" : "token");
  const [clientId, setClientId] = useState(status.oauthClientId);
  const canStart = hasClient || clientId.trim() !== "";
  const startButton = (variant: "primary" | "outline") => (
    <Button
      variant={variant}
      loading={device.starting}
      disabledReason={canStart ? undefined : NO_CLIENT_REASON}
      onClick={() => void device.start(clientId)}
    >
      <Github />
      Mit GitHub verbinden
    </Button>
  );

  if (device.flow) return <DeviceFlowRunning device={device} onUseToken={() => setView("token")} />;

  return (
    <div className="flex flex-col gap-4">
      {device.outcome === "expired" ? (
        <Callout
          variant="danger"
          announce
          title="Der Code ist abgelaufen."
          action={
            <Button variant="outline" loading={device.starting} onClick={() => void device.start(clientId)}>
              Neuen Code anfordern
            </Button>
          }
        />
      ) : device.outcome === "denied" ? (
        <Callout
          variant="warning"
          announce
          title="Du hast den Zugriff auf GitHub abgelehnt."
          action={
            <Button variant="outline" loading={device.starting} onClick={() => void device.start(clientId)}>
              Erneut versuchen
            </Button>
          }
        />
      ) : null}

      <p className="text-sm text-muted-foreground md:text-ui">
        Der Agent arbeitet in einer Sandbox ohne deine Git-Zugangsdaten. Verbinde dein Konto, damit er nach deiner
        Freigabe pushen und Pull Requests öffnen kann.
      </p>

      {hasClient ? (
        view === "device" ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {startButton("primary")}
              <Button variant="link" className="max-md:px-0" onClick={() => setView("token")}>
                Stattdessen Token einfügen
              </Button>
            </div>
            <details className="text-sm text-muted-foreground md:text-ui">
              <summary className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline">Andere OAuth-App verwenden</summary>
              <div className="pt-3">
                <ClientIdField status={status} clientId={clientId} onChange={setClientId} />
              </div>
            </details>
          </>
        ) : (
          <>
            <TokenPanel onConnected={onConnected} />
            <Button variant="link" className="self-start max-md:px-0" onClick={() => setView("device")}>
              Stattdessen mit GitHub anmelden
            </Button>
          </>
        )
      ) : (
        <>
          <TokenPanel onConnected={onConnected} />
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div>
              <h4 className="text-sm font-medium text-foreground md:text-ui">Anmeldung per Code (Device Flow)</h4>
              <p className="text-sm text-muted-foreground md:text-ui">
                Ohne Token kopieren: mit einer eigenen GitHub-OAuth-App meldest du dich direkt bei GitHub an.
              </p>
            </div>
            <ClientIdField status={status} clientId={clientId} onChange={setClientId} />
            <div>{startButton("outline")}</div>
          </div>
        </>
      )}
    </div>
  );
}

function ConnectedView({
  status,
  onStatus,
  onReconnect,
}: {
  status: GithubStatus;
  onStatus: (s: GithubStatus) => void;
  onReconnect: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [repos, setRepos] = useState<RepoCheck[] | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const warnings = status.tokenReadable ? status.warnings : status.warnings.filter((w) => !UNREADABLE_WARNING.test(w));

  async function test() {
    setTesting(true);
    setRepos(null);
    try {
      const d = await api<{ repos: RepoCheck[] }>("/api/github/test", jsonInit("POST"));
      setRepos(d.repos);
      toast.success("Verbindung funktioniert", {
        description: d.repos.length ? `${d.repos.filter((r) => r.push).length} von ${d.repos.length} Repos mit Push-Recht` : undefined,
      });
    } catch (err) {
      toast.error(`Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : "unbekannter Fehler"}`);
    } finally {
      setTesting(false);
    }
  }

  async function disconnectNow() {
    const ok = await confirm({
      title: "GitHub trennen?",
      description: "Agenten können danach nicht mehr pushen. Widerrufe den Token zusätzlich auf github.com.",
      confirmLabel: "Trennen",
      tone: "danger",
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      const d = await api<{ status: GithubStatus }>("/api/github", jsonInit("DELETE"));
      onStatus(d.status);
      toast.success("GitHub getrennt");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Trennen fehlgeschlagen.");
    } finally {
      setDisconnecting(false);
    }
  }

  const revokeUrl =
    status.method === "device"
      ? status.oauthClientId
        ? `https://github.com/settings/connections/applications/${encodeURIComponent(status.oauthClientId)}`
        : "https://github.com/settings/applications"
      : status.tokenKind === "fine-grained"
        ? "https://github.com/settings/personal-access-tokens"
        : "https://github.com/settings/tokens";

  const tokenKind = status.tokenKind ? KIND_LABEL[status.tokenKind] ?? status.tokenKind : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {status.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar, no next/image domain config needed
          <img src={status.avatarUrl} alt="" width={48} height={48} className="size-12 shrink-0 rounded-full border border-border" />
        ) : (
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-base font-semibold text-foreground">
            {(status.login ?? "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">{status.name || status.login}</p>
          <p className="text-xs text-muted-foreground md:text-ui">
            {status.profileUrl ? <ExtLink href={status.profileUrl}>@{status.login}</ExtLink> : <>@{status.login}</>} · verbunden seit{" "}
            {formatDay(status.connectedAt)} · {METHOD_LABEL[status.method ?? ""] ?? "–"}
          </p>
        </div>
      </div>

      {!status.tokenReadable ? (
        <Callout
          variant="danger"
          title="Token ungültig oder nicht lesbar (Server-Schlüssel geändert)."
          action={
            <Button variant="primary" onClick={onReconnect}>
              Erneut verbinden
            </Button>
          }
        >
          Verbinde dein Konto neu, damit Agenten wieder pushen können.
        </Callout>
      ) : null}

      <InfoRows
        rows={[
          {
            label: "Berechtigung",
            value:
              status.scopes.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {status.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono">
                      {s}
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {status.tokenKind === "fine-grained" || status.tokenKind === "app"
                    ? "Berechtigungen statt Scopes (auf GitHub festgelegt)"
                    : "keine Scopes gemeldet"}
                </span>
              ),
          },
          ...(tokenKind ? [{ label: "Token", value: <span>{tokenKind}</span> }] : []),
          ...(status.expiresAt
            ? [
                {
                  label: "Gültig bis",
                  value: (
                    <span>
                      {formatDateTime(status.expiresAt)}
                      {status.autoRefresh ? <span className="text-muted-foreground"> · wird automatisch erneuert</span> : null}
                    </span>
                  ),
                },
              ]
            : []),
          ...(status.gitIdentity && status.commitEmail
            ? [{ label: "Commits als", value: <span className="break-all">{status.name || status.login} · {status.commitEmail}</span> }]
            : []),
        ]}
      />

      {warnings.map((w) => (
        <Callout key={w} variant="warning">
          {w}
        </Callout>
      ))}

      {repos ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Zuletzt gepushte Repositories</p>
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground md:text-ui">Keine Repositories sichtbar – prüfe den Repository-Zugriff des Tokens.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border text-sm md:text-ui">
              {repos.map((r) => (
                <li key={r.fullName} className="flex min-h-10 items-center gap-2 px-3 py-1.5">
                  {r.push ? <Check aria-hidden className="size-3.5 shrink-0 text-success" /> : <X aria-hidden className="size-3.5 shrink-0 text-danger" />}
                  <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-xs hover:underline">
                    {r.fullName}
                    <span className="sr-only"> (öffnet in neuem Tab)</span>
                  </a>
                  {r.private ? <Badge variant="neutral">privat</Badge> : null}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.push ? "Push erlaubt" : "nur lesen"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          className="flex-1 sm:flex-none"
          loading={testing}
          disabledReason={status.tokenReadable ? undefined : "Der gespeicherte Token ist nicht lesbar."}
          onClick={() => void test()}
        >
          <Plug />
          Verbindung testen
        </Button>
        <Button variant="danger-outline" loading={disconnecting} onClick={() => void disconnectNow()}>
          <Unplug />
          Trennen
        </Button>
        <ExtLink href={revokeUrl} className="text-xs sm:ml-auto">
          Auf GitHub widerrufen
        </ExtLink>
      </div>
    </div>
  );
}

function AccountCard({ status, onStatus }: { status: GithubStatus; onStatus: (s: GithubStatus) => void }) {
  const [reconnect, setReconnect] = useState(false);
  // Both connect paths (device flow, token) leave the „Erneut verbinden" view.
  const onConnected = useCallback(
    (s: GithubStatus) => {
      setReconnect(false);
      onStatus(s);
    },
    [onStatus],
  );
  const device = useDeviceFlow(onConnected);
  const unreadable = status.connected && !status.tokenReadable;

  const badge = device.flow ? (
    <Badge variant="info" icon={<LoaderCircle aria-hidden className="motion-safe:animate-spin" />}>
      Warte auf Bestätigung
    </Badge>
  ) : status.connected && status.tokenReadable ? (
    <Badge variant="success" icon={<Check aria-hidden />}>
      verbunden
    </Badge>
  ) : unreadable ? (
    <Badge variant="danger">Token ungültig</Badge>
  ) : (
    <Badge variant="neutral">nicht verbunden</Badge>
  );

  const description = device.flow
    ? "Verbindung über GitHub Device Flow"
    : status.connected
      ? `Verbunden über ${METHOD_LABEL[status.method ?? ""] ?? "GitHub"}`
      : "Nicht verbunden";

  const connectedAndOk = status.connected && !reconnect && !device.flow;

  return (
    <SettingsCard title="GitHub-Konto" description={description} icon={<Github />} badge={badge}>
      {connectedAndOk ? (
        <ConnectedView status={status} onStatus={onStatus} onReconnect={() => setReconnect(true)} />
      ) : (
        <>
          <ConnectPanel status={status} device={device} onConnected={onConnected} />
          {reconnect && !device.flow ? (
            <Button variant="ghost" className="mt-3" onClick={() => setReconnect(false)}>
              Abbrechen
            </Button>
          ) : null}
        </>
      )}
    </SettingsCard>
  );
}

function AgentsCard({ status, onStatus }: { status: GithubStatus; onStatus: (s: GithubStatus) => void }) {
  const [saving, setSaving] = useState<"" | "injectIntoAssistant" | "gitIdentity">("");

  async function setOption(key: "injectIntoAssistant" | "gitIdentity", value: boolean) {
    setSaving(key);
    try {
      const d = await api<{ status: GithubStatus }>("/api/github", jsonInit("PATCH", { [key]: value }));
      onStatus(d.status);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving("");
    }
  }

  return (
    <SettingsCard title="Agenten & Git" description="Gilt für alle Assistent-Sessions.">
      <div className="flex flex-col divide-y divide-border">
        <SwitchRow
          label="Token an Agenten weitergeben"
          description={
            <>
              Assistent-Läufe können damit pushen und <Code>gh</Code> nutzen.
            </>
          }
          checked={status.injectIntoAssistant}
          disabled={saving !== ""}
          aria-busy={saving === "injectIntoAssistant" || undefined}
          onCheckedChange={(v) => void setOption("injectIntoAssistant", v)}
        />
        <SwitchRow
          label="Commits mit deiner GitHub-Identität"
          description={
            status.commitEmail ? (
              <>
                Commits als {status.name || status.login} &lt;<span className="break-all">{status.commitEmail}</span>&gt; – die
                private noreply-Adresse verhindert Push-Ablehnungen wegen E-Mail-Datenschutz.
              </>
            ) : (
              "Name und private noreply-Adresse deines Kontos als Autor (sobald verbunden)."
            )
          }
          checked={status.gitIdentity}
          disabled={saving !== ""}
          aria-busy={saving === "gitIdentity" || undefined}
          onCheckedChange={(v) => void setOption("gitIdentity", v)}
        />
      </div>
      <p className="mt-3 flex gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted-foreground md:text-ui">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <span>
          Jeder <Code>git push</Code> läuft über die Freigabe der Session – mit ‚Bearbeiten mit Freigabe‘ siehst du ihn als
          Freigabe-Karte.
        </span>
      </p>
    </SettingsCard>
  );
}

export function GithubSettings() {
  const [status, setStatusState] = useState<GithubStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const setStatus = useCallback((s: GithubStatus) => {
    setStatusState(s);
    publishGithubHint(s);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const d = await api<{ status: GithubStatus }>("/api/github");
      setStatus(d.status);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Status konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [setStatus]);

  useEffect(() => {
    let alive = true;
    api<{ status: GithubStatus }>("/api/github")
      .then((d) => {
        if (alive) setStatus(d.status);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "Status konnte nicht geladen werden.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [setStatus]);

  return (
    <div className="space-y-4">
      <SectionHeader title="GitHub" description="Damit Agenten in Sessions committen, pushen und Pull Requests öffnen können." />

      <Callout variant="info" icon={<Lock />} title="Warum ein Token?">
        Die Sandbox sperrt SSH-Schlüssel und Schlüsselbund. CodeMaestro gibt Git stattdessen ein Token über HTTPS –
        verschlüsselt auf deinem Server gespeichert.
      </Callout>

      {loadError && !status ? (
        <Callout
          variant="danger"
          title="Status konnte nicht geladen werden"
          action={
            <Button variant="outline" loading={loading} onClick={() => void load()}>
              Erneut versuchen
            </Button>
          }
        >
          {loadError}
        </Callout>
      ) : null}

      {!status && !loadError ? (
        <SettingsCard title="GitHub-Konto" icon={<Github />} aria-busy>
          <span className="sr-only" role="status">
            Status wird geladen …
          </span>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-48" />
          </div>
        </SettingsCard>
      ) : null}

      {status ? (
        <>
          <AccountCard status={status} onStatus={setStatus} />
          <AgentsCard status={status} onStatus={setStatus} />
        </>
      ) : null}

      <details className="group rounded-lg border border-border bg-card text-sm md:text-ui">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 font-medium text-foreground md:min-h-10 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-subtle-foreground transition-transform group-open:rotate-90">›</span>
          So nutzt der Assistent das Konto
        </summary>
        <ul className="list-disc space-y-1.5 border-t border-border py-3 pl-9 pr-4 text-muted-foreground">
          <li>
            Jeder Assistent-Lauf erhält <Code>GH_TOKEN</Code> und einen git-Credential-Helper für github.com. SSH-Remotes (
            <Code>git@github.com:…</Code>) werden automatisch über HTTPS geleitet.
          </li>
          <li>
            Die Session braucht trotzdem Bash-Rechte für git – z. B. das Tool <Code>Bash</Code> oder das Git-Preset in den
            Session-Einstellungen. Ohne diese Freigabe blockiert Claude Code <Code>git push</Code>.
          </li>
          <li>Mit aktivierter Sandbox werden die GitHub-Domains automatisch im Sandbox-Netzwerk freigegeben.</li>
          <li>
            Der Agent kann den Token technisch auslesen. Für weniger Risiko einen fein-granularen Token verwenden, der nur für
            die gewünschten Repositories gilt.
          </li>
        </ul>
      </details>

      <p className="flex items-start gap-2 text-xs text-muted-foreground md:text-ui">
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Der Token wird verschlüsselt auf deinem Server gespeichert und nur für Git-Operationen genutzt.
      </p>
    </div>
  );
}
