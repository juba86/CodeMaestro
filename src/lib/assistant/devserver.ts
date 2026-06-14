import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import net from "net";

interface DevProc {
  child: ChildProcess;
  port: number;
  command: string;
  logs: string[];
  startedAt: number;
  exited: boolean;
  exitInfo?: string;
}

// One dev server per assistant session.
const devs = new Map<string, DevProc>();
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

export function getDev(sessionId: string) {
  const d = devs.get(sessionId);
  if (!d) return { running: false as const };
  return {
    running: !d.exited,
    port: d.port,
    command: d.command,
    startedAt: d.startedAt,
    logs: d.logs.slice(-120),
    exitInfo: d.exitInfo,
  };
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
  const d: DevProc = { child, port, command, logs: [], startedAt: Date.now(), exited: false };
  devs.set(sessionId, d);

  child.stdout?.on("data", (c: Buffer) => pushLog(d, c.toString()));
  child.stderr?.on("data", (c: Buffer) => pushLog(d, c.toString()));
  child.on("error", (e) => { pushLog(d, `[error] ${e.message}`); });
  child.on("close", (code, signal) => {
    d.exited = true;
    d.exitInfo = signal ? `stopped (${signal})` : `exited with code ${code}`;
    pushLog(d, `[process ${d.exitInfo}]`);
  });

  return { port, command };
}
