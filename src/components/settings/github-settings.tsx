"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Github, KeyRound, Loader2, Plug, Unplug, X } from "lucide-react";
import { toast } from "sonner";

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

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const BTN = "px-3 py-2 text-sm rounded-md border border-input hover:bg-accent disabled:opacity-50 flex items-center gap-1.5";
const BTN_PRIMARY = "px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5";
const CODE = "px-1 bg-accent rounded";

const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=CodeMaestro";
const FINE_GRAINED_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=CodeMaestro&description=Push%20aus%20dem%20CodeMaestro-Assistant&contents=write&pull_requests=write&workflows=write";
const NEW_OAUTH_APP_URL = "https://github.com/settings/applications/new";

const METHOD_LABEL: Record<string, string> = { device: "GitHub-Anmeldung (Device Flow)", token: "Personal Access Token" };
const KIND_LABEL: Record<string, string> = {
  classic: "classic",
  "fine-grained": "fein-granular",
  oauth: "OAuth-App",
  app: "GitHub-App",
  unknown: "unbekannt",
};

// navigator.clipboard only exists in secure contexts (HTTPS / localhost); over
// plain http on a tailnet IP fall back to a hidden textarea.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
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

export function GithubSettings() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"device" | "token">("device");

  useEffect(() => {
    let alive = true;
    api<{ status: GithubStatus }>("/api/github")
      .then((d) => {
        if (alive) setStatus(d.status);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "Status konnte nicht geladen werden.");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Github size={18} className="text-primary" />
        <h2 className="text-lg font-semibold">GitHub</h2>
        {status?.connected ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-500 flex items-center gap-1">
            <Check size={11} /> verbunden · @{status.login}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent text-muted-foreground">nicht verbunden</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Verbinde dein GitHub-Konto, damit der Code-Assistant committen, pushen und <code className={CODE}>gh</code> (z. B.
        Pull Requests) nutzen kann — auch mit aktivierter Sandbox. Der Token wird verschlüsselt auf dem Server gespeichert
        und nie an den Browser zurückgegeben.
      </p>

      {loadError && <p className="text-xs text-red-500">{loadError}</p>}
      {!status && !loadError && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Lade Status …
        </p>
      )}

      {status?.connected && <ConnectedCard status={status} onStatus={setStatus} />}

      {status && !status.connected && (
        <div className="space-y-3">
          <div role="tablist" aria-label="Verbindungsart" className="flex gap-1 border-b border-border">
            {(
              [
                ["device", "Mit GitHub verbinden"],
                ["token", "Personal Access Token"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`px-3 py-2 text-sm -mb-px border-b-2 ${
                  tab === id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "device" ? (
            <DeviceFlowPanel status={status} onConnected={setStatus} />
          ) : (
            <TokenPanel onConnected={setStatus} />
          )}
        </div>
      )}

      <div className="rounded-md border border-border bg-accent/30 p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">So nutzt der Assistant das Konto</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>
            Jede Assistant-Ausführung erhält <code className={CODE}>GH_TOKEN</code> und einen git-Credential-Helper für
            github.com. SSH-Remotes (<code className={CODE}>git@github.com:…</code>) werden automatisch über HTTPS geleitet.
          </li>
          <li>
            Die Session braucht trotzdem Bash-Rechte für git — z. B. das Tool <code className={CODE}>Bash</code> oder das
            Git-Preset in den Session-Einstellungen. Ohne diese Freigabe blockiert Claude Code <code className={CODE}>git push</code>.
          </li>
          <li>Mit aktivierter Sandbox werden die GitHub-Domains automatisch im Sandbox-Netzwerk freigegeben.</li>
          <li>
            Der Assistant kann den Token technisch auslesen. Für weniger Risiko einen fein-granularen Token verwenden, der
            nur für die gewünschten Repositories gilt.
          </li>
        </ul>
      </div>
    </section>
  );
}

function ConnectedCard({ status, onStatus }: { status: GithubStatus; onStatus: (s: GithubStatus) => void }) {
  const [saving, setSaving] = useState<"" | "injectIntoAssistant" | "gitIdentity">("");
  const [testing, setTesting] = useState(false);
  const [repos, setRepos] = useState<RepoCheck[] | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

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

  async function test() {
    setTesting(true);
    setRepos(null);
    try {
      const d = await api<{ repos: RepoCheck[] }>("/api/github/test", jsonInit("POST"));
      setRepos(d.repos);
      toast.success(`Verbindung ok${d.repos.length ? ` — ${d.repos.filter((r) => r.push).length}/${d.repos.length} Repos mit Push-Recht` : ""}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test fehlgeschlagen.");
    } finally {
      setTesting(false);
    }
  }

  async function disconnectNow() {
    if (!confirm("GitHub-Verbindung trennen? Der Token wird hier gelöscht, bleibt auf GitHub aber gültig, bis du ihn dort widerrufst.")) return;
    setDisconnecting(true);
    try {
      const d = await api<{ status: GithubStatus }>("/api/github", jsonInit("DELETE"));
      onStatus(d.status);
      toast.success("Verbindung getrennt.");
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

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        {status.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar, no next/image domain config needed
          <img src={status.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full border border-border" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
            <Github size={22} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium truncate">
            {status.name || status.login}{" "}
            {status.profileUrl && (
              <a href={status.profileUrl} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:text-foreground underline">
                @{status.login}
              </a>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {METHOD_LABEL[status.method ?? ""] ?? "—"}
            {status.tokenKind && status.method === "token" ? ` (${KIND_LABEL[status.tokenKind]})` : ""} · verbunden seit {formatDate(status.connectedAt)}
            {status.expiresAt
              ? ` · Token läuft ab ${formatDate(status.expiresAt)}${status.autoRefresh ? " (wird automatisch erneuert)" : ""}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {status.scopes.length > 0 ? (
              status.scopes.map((s) => (
                <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent">
                  {s}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {status.tokenKind === "fine-grained" || status.tokenKind === "app"
                  ? "Berechtigungen statt Scopes (auf GitHub festgelegt)"
                  : "keine Scopes gemeldet"}
              </span>
            )}
          </div>
        </div>
      </div>

      {status.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-600 dark:text-amber-400">
          {status.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={status.injectIntoAssistant}
            disabled={saving !== ""}
            onChange={(e) => setOption("injectIntoAssistant", e.target.checked)}
          />
          <span>
            Für Code-Assistant bereitstellen (git push, gh)
            {saving === "injectIntoAssistant" && <Loader2 size={12} className="inline ml-1.5 animate-spin" />}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={status.gitIdentity}
            disabled={saving !== ""}
            onChange={(e) => setOption("gitIdentity", e.target.checked)}
          />
          <span>
            Commits unter GitHub-Identität erstellen (Name/E-Mail als Autor)
            {saving === "gitIdentity" && <Loader2 size={12} className="inline ml-1.5 animate-spin" />}
            {status.commitEmail && (
              <span className="block text-xs text-muted-foreground">
                Autor: {status.name || status.login} &lt;{status.commitEmail}&gt; — die private noreply-Adresse verhindert
                Push-Ablehnungen wegen E-Mail-Datenschutz.
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={test} disabled={testing || !status.tokenReadable} className={BTN}>
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
          Verbindung testen
        </button>
        <button onClick={disconnectNow} disabled={disconnecting} className={`${BTN} text-red-500`}>
          {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
          Trennen
        </button>
        <a href={revokeUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1">
          Auf GitHub widerrufen <ExternalLink size={11} />
        </a>
      </div>

      {repos && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Zuletzt gepushte Repositories</p>
          {repos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Repositories sichtbar — prüfe den Repository-Zugriff des Tokens.</p>
          ) : (
            <ul className="text-xs divide-y divide-border rounded-md border border-border">
              {repos.map((r) => (
                <li key={r.fullName} className="flex items-center gap-2 px-2.5 py-1.5">
                  {r.push ? <Check size={13} className="text-green-500 shrink-0" /> : <X size={13} className="text-red-500 shrink-0" />}
                  <a href={r.url} target="_blank" rel="noreferrer" className="font-mono truncate hover:underline">
                    {r.fullName}
                  </a>
                  {r.private && <span className="text-[10px] px-1 rounded bg-accent text-muted-foreground">privat</span>}
                  <span className="ml-auto text-muted-foreground shrink-0">{r.push ? "Push erlaubt" : "nur lesen"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function DeviceFlowPanel({ status, onConnected }: { status: GithubStatus; onConnected: (s: GithubStatus) => void }) {
  const [clientId, setClientId] = useState(status.oauthClientId);
  const [starting, setStarting] = useState(false);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());

  async function start() {
    setStarting(true);
    setNote("");
    try {
      const d = await api<{ flowId: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }>(
        "/api/github/device/start",
        jsonInit("POST", { clientId: clientId.trim() || undefined })
      );
      setNow(Date.now());
      setFlow({ flowId: d.flowId, userCode: d.userCode, verificationUri: d.verificationUri, interval: d.interval, expiresAt: Date.now() + d.expiresIn * 1000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anmeldung konnte nicht gestartet werden.");
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (flow) void fetch("/api/github/device/poll", jsonInit("POST", { flowId: flow.flowId, cancel: true })).catch(() => {});
    setFlow(null);
    setNote("");
  }

  // Poll until GitHub reports a result. The server enforces GitHub's interval,
  // so this loop just follows the interval it reports back.
  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let interval = flow.interval;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      // The server reports expiry itself; this only ends the loop when it
      // can't be reached anymore.
      if (Date.now() > flow.expiresAt + 10_000) {
        toast.error("Code abgelaufen — bitte neu starten.");
        setFlow(null);
        return;
      }
      try {
        const res = await fetch("/api/github/device/poll", jsonInit("POST", { flowId: flow.flowId }));
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(d.error || "Abfrage fehlgeschlagen.");
          setFlow(null);
          return;
        }
        if (typeof d.interval === "number" && d.interval > 0) interval = d.interval;
        if (d.status === "connected") {
          toast.success("GitHub verbunden.");
          setFlow(null);
          if (d.github) onConnected(d.github);
          return;
        }
        if (d.status === "pending" || d.status === "slow_down") {
          setNote(d.message || "");
        } else {
          toast.error(d.message || "Anmeldung fehlgeschlagen.");
          setFlow(null);
          return;
        }
      } catch {
        if (cancelled) return;
        setNote("Server nicht erreichbar — neuer Versuch …");
      }
      timer = setTimeout(tick, interval * 1000 + 500);
    };
    timer = setTimeout(tick, interval * 1000 + 500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [flow, onConnected]);

  async function copyCode() {
    if (!flow) return;
    if (await copyText(flow.userCode)) toast.success("Code kopiert.");
    else toast.error("Kopieren nicht möglich — bitte manuell abtippen.");
  }

  if (flow) {
    const left = Math.max(0, Math.round((flow.expiresAt - now) / 1000));
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm">
          1. Code kopieren · 2. Auf GitHub öffnen und eingeben · 3. Zugriff bestätigen. Diese Seite verbindet sich danach automatisch.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-3xl font-semibold tracking-[0.2em] select-all" aria-label="Gerätecode">
            {flow.userCode}
          </span>
          <button onClick={copyCode} className={BTN}>
            <Copy size={14} /> Kopieren
          </button>
          <a href={flow.verificationUri} target="_blank" rel="noreferrer" className={BTN_PRIMARY}>
            {flow.verificationUri.replace(/^https?:\/\//, "")} öffnen <ExternalLink size={13} />
          </a>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5" aria-live="polite">
          <Loader2 size={12} className="animate-spin" />
          Warte auf Bestätigung auf GitHub … (läuft ab in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")})
          {note && <span className="text-amber-600 dark:text-amber-400"> · {note}</span>}
        </p>
        <button onClick={cancel} className={BTN}>
          Abbrechen
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="gh-client-id" className="text-sm font-medium">
          OAuth-App-Client-ID
        </label>
        <div className="flex gap-2">
          <input
            id="gh-client-id"
            type="text"
            className={INPUT}
            placeholder={status.envClientId ? "leer = GITHUB_OAUTH_CLIENT_ID vom Server" : "z. B. Ov23li…"}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button onClick={start} disabled={starting || (!clientId.trim() && !status.envClientId)} className={`${BTN_PRIMARY} shrink-0`}>
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
            Code anfordern
          </button>
        </div>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Wie bekomme ich eine Client-ID? (einmalig, ca. 1 Minute)</summary>
        <ol className="list-decimal pl-4 pt-2 space-y-1">
          <li>
            GitHub → Settings → Developer settings → OAuth Apps →{" "}
            <a href={NEW_OAUTH_APP_URL} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              New OAuth App
            </a>
            .
          </li>
          <li>
            Name beliebig (z. B. „CodeMaestro“), Homepage-URL beliebig (z. B. <code className={CODE}>http://localhost:3000</code>). Die
            Callback-URL wird nicht verwendet — irgendeine gültige URL eintragen.
          </li>
          <li>
            <strong>„Enable Device Flow“</strong> ankreuzen (beim Anlegen oder danach in den App-Einstellungen).
          </li>
          <li>Client-ID kopieren und hier eintragen. Ein Client-Secret wird nicht benötigt.</li>
        </ol>
        <p className="pt-2">
          Angefragte Berechtigungen: <code className={CODE}>repo</code>, <code className={CODE}>workflow</code>,{" "}
          <code className={CODE}>read:org</code>.
        </p>
      </details>
    </div>
  );
}

function TokenPanel({ onConnected }: { onConnected: (s: GithubStatus) => void }) {
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      const d = await api<{ status: GithubStatus }>("/api/github/token", jsonInit("POST", { token: token.trim() }));
      setToken("");
      onConnected(d.status);
      toast.success(`Verbunden als @${d.status.login}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verbinden fehlgeschlagen.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="gh-token" className="text-sm font-medium">
          Token
        </label>
        <div className="flex gap-2">
          <input
            id="gh-token"
            type="password"
            className={INPUT}
            placeholder="ghp_… oder github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && token.trim() && !connecting) void connect();
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <button onClick={connect} disabled={connecting || !token.trim()} className={`${BTN_PRIMARY} shrink-0`}>
            {connecting ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Verbinden
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 text-xs text-muted-foreground">
        <div className="space-y-1 rounded-md border border-border p-3">
          <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline flex items-center gap-1">
            Classic Token erstellen <ExternalLink size={11} />
          </a>
          <p>
            Scopes <code className={CODE}>repo</code> und <code className={CODE}>workflow</code> (optional{" "}
            <code className={CODE}>read:org</code>). Gilt für alle Repos, auf die du Zugriff hast — auch als Collaborator und
            über mehrere Organisationen.
          </p>
        </div>
        <div className="space-y-1 rounded-md border border-border p-3">
          <a href={FINE_GRAINED_TOKEN_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline flex items-center gap-1">
            Fein-granularen Token erstellen <ExternalLink size={11} />
          </a>
          <p>
            Repositories auswählen, dann Berechtigungen: <strong>Contents</strong>, <strong>Pull requests</strong> und{" "}
            <strong>Workflows</strong> jeweils „Read and write“ (Metadata kommt automatisch). Gilt nur für einen Owner
            (Nutzer oder Organisation).
          </p>
        </div>
      </div>
    </div>
  );
}
