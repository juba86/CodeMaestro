import { execFile, spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import net from "net";

/** Tailnet HTTPS exposure of a dev server via `tailscale serve` (opt-in). */
type ServeState = "off" | "pending" | "active" | "failed";

interface DevProc {
  child: ChildProcess;
  port: number;
  command: string;
  logs: string[];
  startedAt: number;
  exited: boolean;
  exitInfo?: string;
  serve: ServeState;
  /** https://<magicdns>:<port> once `tailscale serve` is active. */
  url: string | null;
  /** Settles when the serve setup attempt has finished (success or not). */
  serveReady: Promise<void>;
}

// One dev server per assistant session. On globalThis so every route bundle
// (and the Telegram bridge's module graph) sees the same processes.
const g = globalThis as unknown as { __cmDevServers?: Map<string, DevProc>; __cmTsQueue?: Promise<unknown> };
const devs: Map<string, DevProc> = (g.__cmDevServers ??= new Map());
const MAX_LOG_LINES = 300;

function pushLog(d: DevProc, chunk: string) {
  for (const line of chunk.split("\n")) {
    if (line.length) d.logs.push(line);
  }
  if (d.logs.length > MAX_LOG_LINES) d.logs.splice(0, d.logs.length - MAX_LOG_LINES);
}

/** Finds a free TCP port at or after `from` (skipping ones already in use). */
export function findFreePort(from = 4300): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (p: number) => {
      const srv = net.createServer();
      srv.once("error", () => { srv.close(); if (p < from + 200) tryPort(p + 1); else resolve(from); });
      srv.once("listening", () => { srv.close(() => resolve(p)); });
      srv.listen(p, "0.0.0.0");
    };
    tryPort(from);
  });
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Suggests a start command + framework for a project directory. */
export async function detectStartCommand(cwd: string, port: number): Promise<{ command: string; framework: string }> {
  let pkg: PackageJson | null = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
  } catch {
    pkg = null;
  }

  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};
    if (deps.next) {
      const script = scripts.dev ? "dev" : scripts.start ? "start" : "dev";
      return { command: `npx next ${script === "start" ? "start" : "dev"} -H 0.0.0.0 -p ${port}`, framework: "Next.js" };
    }
    if (deps.vite || scripts.dev?.includes("vite")) {
      return { command: `npm run dev -- --host 0.0.0.0 --port ${port}`, framework: "Vite" };
    }
    if (deps["react-scripts"]) {
      return { command: `npm start`, framework: "Create React App" };
    }
    if (deps.astro) {
      return { command: `npm run dev -- --host 0.0.0.0 --port ${port}`, framework: "Astro" };
    }
    if (scripts.dev) return { command: `npm run dev`, framework: "npm (dev)" };
    if (scripts.start) return { command: `npm start`, framework: "npm (start)" };
  }

  // Python fallbacks
  for (const [file, cmd, fw] of [
    ["manage.py", `python manage.py runserver 0.0.0.0:${port}`, "Django"],
    ["app.py", `python app.py`, "Python (app.py)"],
    ["main.py", `python main.py`, "Python (main.py)"],
  ] as const) {
    try { await fs.access(path.join(cwd, file)); return { command: cmd, framework: fw }; } catch { /* next */ }
  }

  return { command: `npm run dev`, framework: "unknown" };
}

// --- tailscale serve (CODEMAESTRO_DEV_TAILSCALE_SERVE=1) -------------------------
//
// When CodeMaestro itself runs on https://<machine>.<tailnet>.ts.net, a plain
// http://<host>:<port> link to the dev server is blocked as mixed content and
// cannot be installed/tested as a PWA. With the opt-in flag each dev server is
// additionally exposed as https://<machine>.<tailnet>.ts.net:<port> via
//   tailscale serve --bg --https=<port> http://127.0.0.1:<port>
// and turned off again with `tailscale serve --https=<port> off` when it stops.
// Failures are logged into the dev server's log and never block the start.

const TS_TIMEOUT_MS = 20_000;

export function devTailscaleServeEnabled(): boolean {
  const v = (process.env.CODEMAESTRO_DEV_TAILSCALE_SERVE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function runTailscale(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // execFile: no shell, fixed binary, numeric port arguments only.
    const child = execFile("tailscale", args, { timeout: TS_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const errText = !err
        ? ""
        : (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "Tailscale-CLI nicht gefunden (nicht installiert oder nicht im PATH)"
          : err.killed
            ? `Timeout nach ${TS_TIMEOUT_MS / 1000}s`
            : err.message;
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "").trim() || errText });
    });
    // Never wait on an interactive prompt.
    child.stdin?.end();
  });
}

/** Serializes `tailscale serve` changes (concurrent edits of the serve config race). */
function tsQueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__cmTsQueue ?? Promise.resolve();
  const run = prev.then(fn, fn);
  g.__cmTsQueue = run.catch(() => {});
  return run;
}

async function magicDnsName(): Promise<string> {
  const st = await runTailscale(["status", "--json"]);
  if (!st.ok) throw new Error(`tailscale status: ${st.stderr || "fehlgeschlagen"}`);
  const json = JSON.parse(st.stdout) as {
    BackendState?: string;
    Self?: { DNSName?: string };
    CertDomains?: string[] | null;
  };
  if (json.BackendState !== "Running") throw new Error(`Tailscale ist nicht verbunden (${json.BackendState ?? "unbekannt"}).`);
  const name = (json.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!name) throw new Error("Kein MagicDNS-Name — MagicDNS in der Tailscale-Admin-Konsole aktivieren.");
  if (!(json.CertDomains ?? []).includes(name)) {
    throw new Error("HTTPS-Zertifikate sind im Tailnet nicht aktiviert (Admin-Konsole → DNS → HTTPS Certificates).");
  }
  return name;
}

/** What `tailscale serve` currently does on a TCP port (null = nothing). */
async function serveTargetOnPort(port: number): Promise<string | null | "other"> {
  const st = await runTailscale(["serve", "status", "--json"]);
  if (!st.ok || !st.stdout.trim()) return null;
  let cfg: {
    TCP?: Record<string, unknown>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  };
  try { cfg = JSON.parse(st.stdout); } catch { return null; }
  if (!cfg?.TCP?.[String(port)]) return null;
  for (const [hostPort, web] of Object.entries(cfg.Web ?? {})) {
    if (!hostPort.endsWith(`:${port}`)) continue;
    const proxy = web.Handlers?.["/"]?.Proxy;
    if (proxy) return proxy;
  }
  return "other";
}

async function exposeViaTailscale(d: DevProc): Promise<void> {
  const target = `http://127.0.0.1:${d.port}`;
  try {
    const name = await magicDnsName();
    const existing = await serveTargetOnPort(d.port);
    if (existing && existing !== target) {
      throw new Error(`Port ${d.port} ist in tailscale serve bereits anders belegt (${existing}) — nicht überschrieben.`);
    }
    if (!existing) {
      const res = await runTailscale(["serve", "--bg", `--https=${d.port}`, target]);
      if (!res.ok) throw new Error(res.stderr || "tailscale serve fehlgeschlagen");
    }
    if (d.exited) {
      // Stopped while we were setting up — undo right away.
      d.serve = "active";
      await unexpose(d);
      return;
    }
    d.serve = "active";
    d.url = `https://${name}:${d.port}`;
    pushLog(d, `[tailscale] HTTPS im Tailnet: ${d.url}`);
  } catch (err) {
    d.serve = "failed";
    pushLog(d, `[tailscale] serve nicht eingerichtet: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function unexpose(d: DevProc): Promise<void> {
  if (d.serve !== "active") return;
  d.serve = "off";
  d.url = null;
  // Another live dev server took over the same port — its mapping is identical.
  for (const other of devs.values()) {
    if (other !== d && !other.exited && other.port === d.port && other.serve !== "off" && other.serve !== "failed") return;
  }
  const res = await runTailscale(["serve", `--https=${d.port}`, "off"]);
  pushLog(d, res.ok ? `[tailscale] serve für Port ${d.port} beendet` : `[tailscale] serve off fehlgeschlagen: ${res.stderr}`);
}

export function getDev(sessionId: string) {
  const d = devs.get(sessionId);
  if (!d) return { running: false as const, url: null };
  return {
    running: !d.exited,
    port: d.port,
    command: d.command,
    startedAt: d.startedAt,
    logs: d.logs.slice(-120),
    exitInfo: d.exitInfo,
    /** HTTPS tailnet URL when proxied via `tailscale serve`; prefer it over host:port. */
    url: d.exited ? null : d.url,
    serve: d.serve,
  };
}

/** Waits (bounded) until a just-started dev server's tailscale setup settled. */
export async function waitForDevUrl(sessionId: string, timeoutMs = 8_000): Promise<void> {
  const d = devs.get(sessionId);
  if (!d || d.serve !== "pending") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([d.serveReady, new Promise<void>((r) => { timer = setTimeout(r, timeoutMs); })]);
  if (timer) clearTimeout(timer);
}

export function stopDev(sessionId: string): boolean {
  const d = devs.get(sessionId);
  if (d && !d.exited) {
    // Kill the whole process group (dev servers often spawn children).
    try { process.kill(-d.child.pid!, "SIGTERM"); } catch { d.child.kill("SIGTERM"); }
    return true;
  }
  return false;
}

export function startDev(sessionId: string, cwd: string, command: string, port: number) {
  // Replace any existing dev server for this session.
  stopDev(sessionId);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: "0.0.0.0",
    HOSTNAME: "0.0.0.0",
    BROWSER: "none",
    FORCE_COLOR: "0",
  };
  const child = spawn("sh", ["-c", command], { cwd, env, detached: true });
  const serveWanted = devTailscaleServeEnabled();
  const d: DevProc = {
    child, port, command, logs: [], startedAt: Date.now(), exited: false,
    serve: serveWanted ? "pending" : "off",
    url: null,
    serveReady: Promise.resolve(),
  };
  devs.set(sessionId, d);

  child.stdout?.on("data", (c: Buffer) => pushLog(d, c.toString()));
  child.stderr?.on("data", (c: Buffer) => pushLog(d, c.toString()));
  child.on("error", (e) => { pushLog(d, `[error] ${e.message}`); });
  child.on("close", (code, signal) => {
    d.exited = true;
    d.exitInfo = signal ? `stopped (${signal})` : `exited with code ${code}`;
    pushLog(d, `[process ${d.exitInfo}]`);
    // After a pending setup finishes it sees `exited` and undoes itself.
    if (d.serve === "active") void tsQueue(() => unexpose(d));
  });

  if (serveWanted) d.serveReady = tsQueue(() => exposeViaTailscale(d));

  return { port, command };
}
