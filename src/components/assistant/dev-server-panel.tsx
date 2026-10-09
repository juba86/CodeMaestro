"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/ui/copy-text";
import type { DevStatus } from "./types";

/**
 * Link to the session's dev server. Prefers the server-provided URL (HTTPS via
 * `tailscale serve`); a raw dev port is never TLS, so the fallback is always
 * http — even when this app itself is served over https.
 */
export function devHref(dev: DevStatus): string {
  if (dev.url && /^https?:\/\//i.test(dev.url)) return dev.url;
  const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
  return `http://${host}:${dev.port}`;
}

/** Dev-server launcher state of one session (status, command, port, polling while it runs). */
export function useDevServer(sessionId: string | null) {
  const [state, setState] = React.useState<{ sid: string; status: DevStatus } | null>(null);
  const [cmd, setCmd] = React.useState("");
  const [port, setPort] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const status = state && state.sid === sessionId ? state.status : null;

  const load = React.useCallback(async (sid: string) => {
    const d = (await fetch(`/api/assistant/sessions/${encodeURIComponent(sid)}/dev`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null)) as DevStatus | null;
    if (!d) return;
    setState({ sid, status: d });
    if (d.suggestion) {
      setCmd(d.suggestion.command);
      setPort(d.suggestion.port);
    } else if (d.command && d.port) {
      setCmd(d.command);
      setPort(d.port);
    }
  }, []);

  React.useEffect(() => {
    if (sessionId) void load(sessionId);
  }, [sessionId, load]);

  // Poll the status (logs/exit) while it runs.
  const running = !!status?.running;
  React.useEffect(() => {
    if (!sessionId || !running) return;
    // Not while hidden: a backgrounded PWA must not wake the radio every 3 s.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load(sessionId);
    }, 3000);
    return () => clearInterval(t);
  }, [sessionId, running, load]);

  const start = async () => {
    if (!sessionId || !cmd.trim() || !port) return;
    const sid = sessionId;
    setBusy(true);
    try {
      const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(sid)}/dev`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, port }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Start fehlgeschlagen.");
        return;
      }
      setState({ sid, status: d });
      toast.success(`App gestartet auf Port ${port}.`);
    } catch {
      toast.error("Server nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await fetch(`/api/assistant/sessions/${encodeURIComponent(sessionId)}/dev/stop`, { method: "POST" }).catch(() => {});
      await load(sessionId);
      toast.info("App gestoppt.");
    } finally {
      setBusy(false);
    }
  };

  return { status, cmd, setCmd, port, setPort, start, stop, busy };
}

export type DevServer = ReturnType<typeof useDevServer>;

function CopyUrl({ url }: { url: string }) {
  const { copied, copy } = useCopy();
  return (
    <IconButton aria-label={copied ? "Kopiert" : "Adresse kopieren"} size="icon" onClick={() => void copy(url)}>
      {copied ? <Check className="text-success" /> : <Copy />}
    </IconButton>
  );
}

/** Dev-Server tab of the inspector (all of the former header launcher). */
export function DevServerPanel({ dev }: { dev: DevServer }) {
  const s = dev.status;
  const logsRef = React.useRef<HTMLPreElement | null>(null);
  React.useEffect(() => {
    const el = logsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s?.logs]);

  if (!s) return <p className="text-ui text-muted-foreground">Status wird geladen …</p>;
  const url = s.running ? devHref(s) : "";
  return (
    <div className="space-y-3">
      {s.running ? (
        <div className="space-y-2 rounded-lg border border-success-border bg-success-subtle p-3">
          <div className="flex items-center gap-2 text-ui">
            <Badge variant="success" dot>
              läuft
            </Badge>
            <span className="text-muted-foreground tabular-nums">Port {s.port}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate font-mono text-xs text-primary-text underline-offset-4 hover:underline"
            >
              {url}
            </a>
            <CopyUrl url={url} />
            <Button asChild size="sm" variant="primary">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Öffnen
              </a>
            </Button>
          </div>
          {s.command ? <p className="truncate font-mono text-xs text-muted-foreground">$ {s.command}</p> : null}
          <Button variant="danger-outline" size="sm" onClick={() => void dev.stop()} loading={dev.busy}>
            <Square aria-hidden />
            Stoppen
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {s.suggestion ? (
            <p className="text-ui text-muted-foreground">
              Erkannt: <span className="font-mono text-foreground">{s.suggestion.command}</span>
              {s.suggestion.framework && s.suggestion.framework !== "unknown" ? ` · ${s.suggestion.framework}` : ""} · Port {s.suggestion.port}
            </p>
          ) : null}
          <Field>
            <FieldLabel>Start-Befehl</FieldLabel>
            <Input className="font-mono" placeholder="z. B. npm run dev" value={dev.cmd} onChange={(e) => dev.setCmd(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Port</FieldLabel>
            <Input
              type="number"
              inputMode="numeric"
              min={1024}
              max={65535}
              className="w-32 tabular-nums"
              value={dev.port || ""}
              onChange={(e) => dev.setPort(Number(e.target.value))}
            />
          </Field>
          <Button
            variant="primary"
            onClick={() => void dev.start()}
            loading={dev.busy}
            disabledReason={!dev.cmd.trim() ? "Erst einen Start-Befehl eingeben." : !dev.port ? "Erst einen Port eingeben." : undefined}
          >
            <Play aria-hidden />
            Starten
          </Button>
        </div>
      )}
      {!s.running && s.exitInfo ? <Callout variant="warning">{s.exitInfo}</Callout> : null}
      {s.logs && s.logs.length ? (
        <div>
          <div className="mb-1 text-xs text-subtle-foreground">Ausgabe</div>
          <pre
            ref={logsRef}
            tabIndex={0}
            aria-label="Ausgabe des Dev-Servers"
            className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-xs leading-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.logs.join("\n")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
