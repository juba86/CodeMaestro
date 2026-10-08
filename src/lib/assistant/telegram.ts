import { prisma } from "@/lib/db/client";
import { isInside, resolveWorkdir } from "./security";
import { resolveApproval, listPending, type ApprovalEvent, type QuestionItem } from "./approvals";
import {
  SessionBusyError,
  getActiveRun,
  isSessionBusy,
  subscribe,
  type BufferedEvent,
  type RunEndStatus,
  type RunHandle,
} from "./run-hub";
import { executeTurn, launchRun, stopRunNow } from "./session-run";
import { formatDuration, pause, startLoopRun } from "./loop";
import { supportsApprovalGate } from "./runner";
import { getTelegramConfig, type TelegramConfig } from "./telegram-config";
import {
  splitForTelegram,
  tailForTelegram,
  parseCommand,
  parseLoopArgs,
  isChatAllowed,
  formatToolLine,
  formatApprovalText,
  formatQuestionText,
  formatPlanText,
  buttonLabel,
  buildAnswerReason,
  callbackData,
  clipText,
  sliceHead,
  sliceTail,
  PLAN_REJECT_REASON,
  LOOP_MAX_ITERATIONS,
  MAX_MSG,
  type LoopArgs,
} from "./telegram-format";
import { retrieveChunks } from "@/lib/knowledge/retrieve";
import { approvalModeLabel, providerLabel } from "@/lib/labels";
import { promises as fs } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Telegram bridge: an optional, long-poll-based front-end onto the SAME run
// engine the PWA uses (session-run.launchRun + run-hub + approvals). It lets
// you drive the code assistant from Telegram when you are away from the
// Tailscale network. Long-polling (getUpdates) is used because the server is
// private and has no public webhook URL.
//
// Runs started here are ordinary hub runs (origin "telegram"): the PWA can
// attach to them, and their approvals/questions show up in both places. The
// poll loop never waits for a run — turns run detached and are mirrored into
// the chat through a hub subscription, so inline-button callbacks and /stop
// are received while the CLI is working.
// ---------------------------------------------------------------------------

const TG_API = "https://api.telegram.org";
const EDIT_THROTTLE_MS = 2500; // min interval between streaming edits
const CALL_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_SEC = 30;
const BINDINGS_KEY = "telegramChatSessions";

export { splitForTelegram, parseCommand, isChatAllowed, formatToolLine };

// --- Telegram API calls -------------------------------------------------------

// `transient`: no usable Telegram answer (offline, DNS, timeout, 5xx, 429) —
// worth retrying, unlike e.g. 401 for a revoked token.
type TgResult<T> = { ok: true; result: T } | { ok: false; description: string; transient?: boolean };

async function tgCall<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<TgResult<T>> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const data = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!data.ok) {
      return { ok: false, description: data.description || `HTTP ${res.status}`, transient: res.status >= 500 || res.status === 429 };
    }
    return { ok: true, result: data.result as T };
  } catch (err) {
    return { ok: false, transient: true, description: err instanceof Error ? err.message : "Netzwerkfehler" };
  }
}

async function tg<T = unknown>(token: string, method: string, body?: Record<string, unknown>): Promise<T | null> {
  const r = await tgCall<T>(token, method, body);
  return r.ok ? r.result : null;
}

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}
interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  from?: { id: number; username?: string };
}
interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
  from?: { id: number };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<number | null> {
  const chunks = splitForTelegram(text);
  if (!chunks.length) chunks.push("…");
  let lastId: number | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const msg = await tg<TgMessage>(token, "sendMessage", {
      chat_id: chatId,
      text: chunks[i] || "…",
      ...(isLast ? extra : {}),
    });
    if (msg) lastId = msg.message_id;
  }
  return lastId;
}

/** Replaces a message's text. Without `keyboard` any inline keyboard is removed. */
async function editMessage(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard
): Promise<boolean> {
  const r = await tgCall(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: sliceHead(text, MAX_MSG) || "…",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  return r.ok;
}

// --- Incoming media -----------------------------------------------------------

// Where downloaded Telegram attachments are stored, relative to the session's
// working directory. The agent only works inside that folder (Claude Code gets
// --add-dir <cwd>; a file elsewhere needs an approval or is denied outright,
// and other agents are confined to it as well), so the upload goes there — and
// stays readable in later turns and orchestrations. The absolute path is
// handed to the turn so the assistant can Read/process it.
export const UPLOAD_SUBDIR = path.join(".codemaestro", "uploads");

/**
 * Creates <cwd>/.codemaestro/uploads and returns its real path. The folder
 * belongs to the agent's project, so it must not lead out of it through a
 * symlink; a .gitignore keeps uploads out of the project's commits.
 */
export async function ensureUploadDir(cwd: string): Promise<string> {
  const root = await fs.realpath(cwd);
  const dir = path.join(root, UPLOAD_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  const real = await fs.realpath(dir);
  if (!isInside(real, root)) throw new Error(`Upload-Ordner zeigt aus dem Projektordner heraus: ${dir}`);
  await fs.writeFile(path.join(real, ".gitignore"), "*\n", { flag: "wx" }).catch(() => { /* exists */ });
  return real;
}

// Pick the best downloadable image from a message: the largest photo size, or an
// image-typed document. Returns null for non-image messages.
function pickAttachment(msg: TgMessage): { fileId: string; ext: string } | null {
  if (msg.photo && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return { fileId: largest.file_id, ext: ".jpg" };
  }
  if (msg.document && msg.document.mime_type?.startsWith("image/")) {
    const ext = msg.document.file_name ? path.extname(msg.document.file_name) || ".png" : ".png";
    return { fileId: msg.document.file_id, ext };
  }
  return null;
}

// Resolves a Telegram file_id to bytes (getFile → file download) and writes it to
// the session's upload folder (see UPLOAD_SUBDIR). Returns the absolute local
// path, or null on any failure.
async function downloadTelegramFile(token: string, sessionId: string, fileId: string, ext: string): Promise<string | null> {
  try {
    const session = await prisma.assistantSession.findUnique({ where: { id: sessionId }, select: { cwd: true } });
    if (!session) return null;
    const dir = await ensureUploadDir(await resolveWorkdir(session.cwd));
    const info = await tg<{ file_path?: string }>(token, "getFile", { file_id: fileId });
    if (!info?.file_path) return null;
    const res = await fetch(`${TG_API}/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const safeExt = /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
    const dest = path.join(dir, `tg_${stamp}${safeExt}`);
    await fs.writeFile(dest, buf, { flag: "wx" }); // never through an existing file or link
    return dest;
  } catch (err) {
    console.error("[telegram] upload failed", err);
    return null;
  }
}

// --- Bridge state -------------------------------------------------------------

/** An approval/question shown in a chat as a message with inline buttons. */
interface Card {
  approvalId: string;
  runId: string;
  chatId: number;
  kind: "approval" | "ask" | "plan";
  messageId: number | null;
  text: string;
  /** Settles once the current card message has been sent (id known). */
  ready: Promise<void>;
  questions: QuestionItem[];
  answers: Array<{ label: string; answer: string }>;
  /** Result line set when the card was answered from Telegram. */
  outcome?: string;
  closed: boolean;
}

type StartResult = { ok: boolean; error?: string };

interface BridgeState {
  running: boolean;
  /** Bumped by every start/stop; a poll loop exits once it no longer matches. */
  generation: number;
  starting: Promise<StartResult> | null;
  startedAt: number;
  offset: number;
  botId: number;
  abort: AbortController | null;
  error: string;
  botUsername: string;
  // Which assistant session each chat is bound to (persisted in Setting).
  chatSessions: Map<number, string>;
  /** Settles once the persisted bindings are merged in (null = not loaded yet). */
  bindingsLoad: Promise<void> | null;
  bindingsSave: Promise<unknown>;
  // Open approval/question cards by approval id.
  cards: Map<string, Card>;
}

function freshState(): BridgeState {
  return {
    running: false,
    generation: 0,
    starting: null,
    startedAt: 0,
    offset: 0,
    botId: 0,
    abort: null,
    error: "",
    botUsername: "",
    chatSessions: new Map(),
    bindingsLoad: null,
    bindingsSave: Promise.resolve(),
    cards: new Map(),
  };
}

// Process-wide singleton: survives HMR and is shared between the module graphs
// of the route handlers and the instrumentation hook that auto-starts the bridge.
const g = globalThis as unknown as { __tgBridge?: BridgeState };
function state(): BridgeState {
  if (!g.__tgBridge) {
    g.__tgBridge = freshState();
  } else if (!(g.__tgBridge.cards instanceof Map)) {
    // State left by an older version of this module (dev HMR): add the new
    // fields in place so a still-running old loop sees the same object.
    const s = g.__tgBridge as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(freshState())) if (!(k in s) || k === "cards") s[k] = v;
  }
  return g.__tgBridge;
}

export function bridgeStatus() {
  const s = state();
  return {
    running: s.running,
    startedAt: s.startedAt,
    error: s.error,
    botUsername: s.botUsername,
    boundChats: s.chatSessions.size,
  };
}

// --- Chat ↔ session bindings ----------------------------------------------------

/**
 * Merges the persisted bindings into memory once. Concurrent callers share the
 * same load, so nobody sees an empty map while the read is in flight (and
 * creates a session that would replace a persisted binding). A failed load is
 * retried on the next call.
 */
function loadBindings(): Promise<void> {
  const s = state();
  if (!s.bindingsLoad) {
    const load = readBindings(s).catch((err) => {
      console.error("[telegram] loading chat bindings failed", err);
      if (s.bindingsLoad === load) s.bindingsLoad = null;
    });
    s.bindingsLoad = load;
  }
  return s.bindingsLoad;
}

async function readBindings(s: BridgeState): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: BINDINGS_KEY } });
  const parsed = row ? (JSON.parse(row.value) as Record<string, unknown>) : {};
  for (const [chat, sid] of Object.entries(parsed)) {
    const chatId = Number(chat);
    if (Number.isFinite(chatId) && typeof sid === "string" && !s.chatSessions.has(chatId)) {
      s.chatSessions.set(chatId, sid);
    }
  }
}

async function boundSession(chatId: number): Promise<string | undefined> {
  await loadBindings();
  return state().chatSessions.get(chatId);
}

function bindChat(chatId: number, sessionId: string): void {
  const s = state();
  s.chatSessions.set(chatId, sessionId);
  // Serialize writes; each one stores the map as it is when the write runs —
  // after the persisted bindings were merged in, so none of them is dropped.
  s.bindingsSave = s.bindingsSave
    .then(() => loadBindings())
    .then(() => {
      const value = JSON.stringify(Object.fromEntries(s.chatSessions));
      return prisma.setting.upsert({
        where: { key: BINDINGS_KEY },
        update: { value },
        create: { key: BINDINGS_KEY, value },
      });
    })
    .catch((err) => console.error("[telegram] saving chat bindings failed", err));
}

// --- Session helpers ----------------------------------------------------------

/**
 * Agent, gate and sandbox for a new Telegram session. The configured approval
 * mode only applies to agents that can enforce it: the runner refuses to start
 * a session that asks for a gate its agent lacks, so storing it anyway made
 * every Gemini/OpenCode/Codex/Aider turn fail. `notice` (sent to the chat when
 * the session is created) says that this session runs without the gate.
 * Telegram has no sandbox setting, so the sandbox is always off — which every
 * agent supports (were one added, it would apply only where supportsSandbox).
 */
export function telegramSessionSafety(config: Pick<TelegramConfig, "provider" | "approvalMode">): {
  provider: string;
  approvalMode: string;
  sandbox: boolean;
  notice: string | null;
} {
  const provider = config.provider || "claude";
  const wanted = config.approvalMode || "edits";
  if (supportsApprovalGate(provider)) return { provider, approvalMode: wanted, sandbox: false, notice: null };
  const notice =
    wanted === "off"
      ? null
      : `ℹ️ Freigabe „${approvalModeLabel(wanted)}“ gilt nicht für ${providerLabel(provider)} – nur Claude Code und pi legen Änderungen und Befehle zur Freigabe vor. Diese Session läuft ohne Freigabe-Gate.`;
  return { provider, approvalMode: "off", sandbox: false, notice };
}

async function createSession(config: TelegramConfig): Promise<{ id: string; cwd: string; notice: string | null }> {
  const cwd = await resolveWorkdir(config.cwd);
  const { provider, approvalMode, sandbox, notice } = telegramSessionSafety(config);
  const session = await prisma.assistantSession.create({
    data: {
      provider,
      model: config.model || "",
      title: "", // set from the first prompt
      cwd,
      permissionMode: config.permissionMode || "default",
      allowedTools: "Read,Grep,Glob,Edit,Write,Bash",
      approvalMode,
      sandbox,
    },
  });
  return { id: session.id, cwd, notice };
}

async function getActiveSession(token: string, chatId: number, config: TelegramConfig): Promise<string> {
  const existing = await boundSession(chatId);
  if (existing) {
    const row = await prisma.assistantSession.findUnique({ where: { id: existing }, select: { id: true } });
    if (row) return existing;
  }
  const { id, notice } = await createSession(config);
  bindChat(chatId, id);
  if (notice) await sendMessage(token, chatId, notice);
  return id;
}

const BUSY_TEXT = "⏳ In dieser Session läuft bereits eine Aufgabe. /stop zum Abbrechen.";

/** Checks that a run can start in the session; reports the reason otherwise. */
async function canStartRun(token: string, chatId: number, sessionId: string): Promise<boolean> {
  const session = await prisma.assistantSession.findUnique({ where: { id: sessionId }, select: { cwd: true } });
  if (!session) {
    await sendMessage(token, chatId, "⚠️ Session nicht gefunden. /new für eine neue.");
    return false;
  }
  if (isSessionBusy(sessionId)) {
    await sendMessage(token, chatId, BUSY_TEXT);
    return false;
  }
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    await sendMessage(token, chatId, `⚠️ Arbeitsverzeichnis ungültig: ${err instanceof Error ? err.message : "?"}`);
    return false;
  }
  return true;
}

async function reportStartError(token: string, chatId: number, err: unknown): Promise<void> {
  if (err instanceof SessionBusyError) {
    await sendMessage(token, chatId, BUSY_TEXT);
    return;
  }
  console.error("[telegram] run start failed", err);
  await sendMessage(token, chatId, `⚠️ Start fehlgeschlagen: ${err instanceof Error ? err.message : "unbekannter Fehler"}`);
}

/**
 * Starts one assistant turn for a chat and returns as soon as it runs. The turn
 * itself is a detached hub run; `followRun` mirrors it into the chat.
 */
async function startTelegramTurn(token: string, chatId: number, sessionId: string, prompt: string, useKnowledge: boolean) {
  if (!(await canStartRun(token, chatId, sessionId))) return;
  let handle: RunHandle;
  try {
    handle = await launchRun({
      sessionId,
      kind: "turn",
      origin: "telegram",
      title: `Telegram: ${prompt}`,
      // Persisted only once the session is claimed, so a concurrent start
      // (PWA, another chat) leaves no orphaned message.
      userMessage: { content: prompt },
      work: (ctx) => executeTurn(ctx, prompt, { useKnowledge, interactive: true }),
    });
  } catch (err) {
    await reportStartError(token, chatId, err);
    return;
  }
  followRun(token, chatId, handle);
}

const LOOP_PROMISE = "DONE";

/** Starts a server-side loop run (see loop.ts) and mirrors it into the chat. */
async function startTelegramLoop(token: string, chatId: number, sessionId: string, args: LoopArgs, useKnowledge: boolean) {
  if (!(await canStartRun(token, chatId, sessionId))) return;

  let handle: RunHandle;
  try {
    handle = await startLoopRun(
      sessionId,
      {
        prompt: args.prompt,
        maxIterations: args.maxIterations,
        completionPromise: LOOP_PROMISE,
        intervalSec: args.intervalSec,
        freshContext: false,
        stopOnError: true,
        useKnowledge,
      },
      "telegram"
    );
  } catch (err) {
    await reportStartError(token, chatId, err);
    return;
  }
  const gap = args.intervalSec ? `, ${formatDuration(args.intervalSec)} Pause dazwischen` : "";
  await sendMessage(
    token,
    chatId,
    `🔁 Loop gestartet: bis zu ${args.maxIterations} Iteration(en)${gap}. Endet, sobald <promise>${LOOP_PROMISE}</promise> ausgegeben wird. /stop bricht ab.`
  );
  followRun(token, chatId, handle);
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// --- Live mirror of a run -------------------------------------------------------

/**
 * One Telegram message that is edited (throttled) as a run's log grows. Edits
 * are serialized so they never arrive out of order, and the last state is
 * always flushed (trailing edit) instead of being dropped by the throttle.
 * At most one edit waits behind the running one and it sends the latest text
 * when it runs, so a slow Telegram API never builds up a backlog of edits.
 */
class LiveMessage {
  private id: number | null = null;
  private text: string;
  private shown = "";
  private lastEdit = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queued = false;
  private chain: Promise<void>;

  constructor(private readonly token: string, private readonly chatId: number, initial: string) {
    this.text = initial;
    this.chain = (async () => {
      this.id = await sendMessage(token, chatId, initial);
      this.shown = initial;
      this.lastEdit = Date.now();
    })().catch((err) => console.error("[telegram] live message failed", err));
  }

  set(text: string): void {
    this.text = text;
    if (this.timer) return;
    const wait = Math.max(0, this.lastEdit + EDIT_THROTTLE_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enqueuePush();
    }, wait);
  }

  /** Flushes the final state and waits for every pending edit. */
  async finish(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.enqueuePush();
    await this.chain;
  }

  private enqueuePush(): void {
    if (this.queued) return; // the waiting push will send the latest text
    this.queued = true;
    // Each step swallows its own failure so one bad edit never blocks the
    // following ones (or the final answer, which waits for this chain).
    this.chain = this.chain
      .then(async () => {
        this.queued = false;
        const next = tailForTelegram(this.text) || "…";
        if (this.id == null || next === this.shown) return;
        this.lastEdit = Date.now();
        // Only a delivered edit counts as shown, so a failed one (e.g. 429) is
        // retried by the next push.
        if (await editMessage(this.token, this.chatId, this.id, next)) this.shown = next;
      })
      .catch((err) => console.error("[telegram] live edit failed", err));
  }
}

// Longer final answers are cut (a few Telegram messages at most).
const FINAL_ANSWER_MAX = 3 * MAX_MSG;

const LOOP_END_LABEL: Record<string, string> = {
  promise: "Ziel erreicht",
  blocked: "blockiert – braucht deine Eingabe",
  max: "Iterationslimit erreicht",
  stopped: "gestoppt",
  error: "Fehler",
};

/**
 * Mirrors a hub run into a chat: a throttled "streaming" message with text and
 * tool calls, inline-keyboard cards for approvals and questions, and the final
 * answer once the run ends. Works for turns and loops alike.
 */
function followRun(token: string, chatId: number, handle: RunHandle): void {
  const { sessionId, runId } = handle.info;
  const live = new LiveMessage(token, chatId, "💭 …");
  let log = "";
  let segment = ""; // assistant text since the last result
  let answer = "";
  let lastError = "";
  let costUsd = 0;
  let loopEnd: { reason: string; iterations: number } | null = null;

  const append = (line: string) => {
    // Only the tail is ever shown — keep the buffer bounded for long loops.
    log = sliceTail(log + line, 2 * MAX_MSG);
    live.set(log);
  };

  const onEvent = ({ data: e }: BufferedEvent) => {
    switch (e.type) {
      case "text":
        if (typeof e.content === "string" && e.content) {
          segment = sliceTail(segment + e.content, 4 * FINAL_ANSWER_MAX);
          append(e.content);
        }
        break;
      case "tool_use":
        append(`\n${formatToolLine(e.name as string | undefined, e.input)}\n`);
        break;
      case "tool_result":
        if (e.isError) append("  ↳ ⚠️ Tool-Fehler\n");
        break;
      case "notice":
        if (typeof e.content === "string" && e.content) append(`\nℹ️ ${e.content}\n`);
        break;
      case "knowledge": {
        const sources = Array.isArray(e.sources) ? (e.sources as string[]) : [];
        if (sources.length) append(`📚 Wissensbasis: ${sources.length} Quelle(n) (${sources.join(", ")})\n`);
        break;
      }
      case "error":
        if (typeof e.content === "string" && e.content) {
          lastError = e.content;
          append(`\n⚠️ ${e.content}\n`);
        }
        break;
      case "result":
        if (typeof e.costUsd === "number") costUsd += e.costUsd;
        answer = (typeof e.content === "string" && e.content.trim()) || segment.trim() || answer;
        segment = "";
        break;
      case "loop_iteration":
        segment = "";
        append(`\n🔁 Iteration ${String(e.iteration)}/${String(e.maxIterations)}\n`);
        break;
      case "loop_wait":
        if (typeof e.resumeAt === "number") append(`⏸ Nächste Iteration um ${formatClock(e.resumeAt)}\n`);
        break;
      case "loop_end":
        loopEnd = { reason: String(e.reason ?? ""), iterations: Number(e.iterations) || 0 };
        break;
      case "approval_request":
      case "question_request":
        openCard(token, chatId, runId, e as unknown as ApprovalEvent);
        break;
      case "approval_resolved":
      case "question_resolved": {
        const card = state().cards.get(String(e.approvalId));
        if (card) void finishCard(token, card, card.outcome ?? resolvedElsewhere(card, e.decision));
        break;
      }
    }
  };

  const sub = subscribe(sessionId, 0, (ev) => {
    try { onEvent(ev); } catch (err) { console.error("[telegram] mirror failed", err); }
  });
  if (!sub || sub.info.runId !== runId) {
    // The run is already gone (cannot normally happen: we subscribe right
    // after launching it). Say so instead of leaving "💭 …" hanging.
    sub?.unsubscribe();
    live.set("⚠️ Auftrag nicht mehr verfolgbar — Ergebnis in der PWA.");
    void live.finish();
    return;
  }
  for (const ev of sub.replay) onEvent(ev);

  const finalize = async (status: RunEndStatus) => {
    sub.unsubscribe();
    await live.finish();
    // Cards the run left open can no longer be answered.
    for (const card of [...state().cards.values()]) {
      if (card.runId === runId) await finishCard(token, card, "⌛ Nicht mehr aktiv.");
    }

    const cost = costUsd ? ` · $${costUsd.toFixed(4)}` : "";
    // A stopped or crashed CLI never sends its result — fall back to the
    // text it streamed so far.
    answer = clipText(answer || segment.trim(), FINAL_ANSWER_MAX, "\n… (gekürzt — vollständig in der PWA)");
    const end = loopEnd as { reason: string; iterations: number } | null;
    let text: string;
    if (end) {
      const head = `🔁 Loop beendet (${LOOP_END_LABEL[end.reason] ?? end.reason}) nach ${end.iterations} Iteration(en)${cost}`;
      text = answer ? `${head}\n\n${answer}` : head;
    } else if (status === "stopped") {
      text = `⏹ Gestoppt.${answer ? `\n\nLetzte Antwort:\n${answer}` : ""}`;
    } else if (status === "error") {
      text = `⚠️ ${answer || lastError || "Ausführung fehlgeschlagen."}${cost}`;
    } else {
      text = `✅ ${answer || "(kein Textoutput)"}${cost}`;
    }
    await sendMessage(token, chatId, text);
  };

  void handle.finished
    .then(finalize)
    .catch((err) => console.error("[telegram] finishing run mirror failed", err));
}

function resolvedElsewhere(card: Card, decision: unknown): string {
  if (card.kind === "approval") return decision === "allow" ? "✅ Erlaubt (PWA)" : "🚫 Abgelehnt (PWA, Timeout oder Stopp)";
  if (card.kind === "plan" && decision === "allow") return "✅ Plan wird umgesetzt (PWA)";
  return "☑️ Erledigt (PWA, Timeout oder Stopp)";
}

// --- Approval / question cards ------------------------------------------------

function questionKeyboard(approvalId: string, q: QuestionItem | undefined, qi: number): InlineKeyboard | undefined {
  if (!q?.options.length) return undefined;
  const rows: InlineKeyboard = [];
  for (let oi = 0; oi < q.options.length; oi++) {
    const data = callbackData("q", approvalId, qi, oi);
    if (!data) return undefined; // text answers still work
    rows.push([{ text: buttonLabel(`${oi + 1}. ${q.options[oi].label}`), callback_data: data }]);
  }
  return rows;
}

function decisionKeyboard(prefix: "apr" | "pl", approvalId: string, allowText: string, denyText: string): InlineKeyboard | undefined {
  const allow = callbackData(prefix, approvalId, "allow");
  const deny = callbackData(prefix, approvalId, "deny");
  if (!allow || !deny) return undefined;
  return [[{ text: allowText, callback_data: allow }, { text: denyText, callback_data: deny }]];
}

function sendCardMessage(token: string, card: Card, keyboard: InlineKeyboard | undefined): void {
  const fallback = keyboard || card.kind !== "approval" ? "" : "\n\n(Keine Buttons möglich — bitte in der PWA entscheiden.)";
  const text = card.text + fallback;
  card.ready = card.ready
    .then(async () => {
      card.messageId = await sendMessage(token, card.chatId, text, keyboard ? { reply_markup: { inline_keyboard: keyboard } } : undefined);
    })
    .catch((err) => console.error("[telegram] sending card failed", err));
}

/** Shows an approval_request / question_request as a message with buttons. */
function openCard(token: string, chatId: number, runId: string, e: ApprovalEvent): void {
  const cards = state().cards;
  if (cards.has(e.approvalId)) return;
  const kind: Card["kind"] = e.type === "approval_request" ? "approval" : e.kind === "plan" ? "plan" : "ask";
  const questions = kind === "ask" ? e.questions ?? [] : [];
  const card: Card = {
    approvalId: e.approvalId,
    runId,
    chatId,
    kind,
    messageId: null,
    text: "",
    ready: Promise.resolve(),
    questions,
    answers: [],
    closed: false,
  };
  cards.set(e.approvalId, card);

  let keyboard: InlineKeyboard | undefined;
  if (kind === "approval") {
    card.text = formatApprovalText(e);
    keyboard = decisionKeyboard("apr", e.approvalId, "✅ Erlauben", "🚫 Ablehnen");
  } else if (kind === "plan") {
    card.text = formatPlanText(e.plan || "");
    keyboard = decisionKeyboard("pl", e.approvalId, "✅ Plan umsetzen", "🚫 Ablehnen");
  } else {
    card.text = questions.length
      ? formatQuestionText(questions[0], 0, questions.length)
      : "❓ Rückfrage\n\nAntworte mit Text.";
    keyboard = questionKeyboard(e.approvalId, questions[0], 0);
  }
  sendCardMessage(token, card, keyboard);
}

/** Marks a card as done: removes its buttons and appends the outcome. Idempotent. */
async function finishCard(token: string, card: Card, line: string): Promise<void> {
  if (card.closed) return;
  card.closed = true;
  const cards = state().cards;
  if (cards.get(card.approvalId) === card) cards.delete(card.approvalId);
  await card.ready.catch(() => {});
  if (card.messageId != null) await editMessage(token, card.chatId, card.messageId, `${card.text}\n\n${line}`);
}

/** The open card for an approval id, if it belongs to this chat. */
function cardFor(approvalId: string, chatId: number): Card | null {
  const card = state().cards.get(approvalId);
  return card && !card.closed && card.chatId === chatId ? card : null;
}

/** Most recent open question/plan card of a chat (answerable by plain text). */
function openQuestionCard(chatId: number): Card | null {
  let found: Card | null = null;
  for (const card of state().cards.values()) {
    if (!card.closed && card.chatId === chatId && card.kind !== "approval") found = card;
  }
  return found;
}

/**
 * Records the answer to the card's current question. Further questions are
 * asked one after another; after the last one the question is resolved with
 * the PWA's convention (deny + "Der Nutzer hat geantwortet: …").
 * The bookkeeping runs synchronously so a double tap cannot answer twice.
 */
function answerQuestion(token: string, card: Card, answer: string): "next" | "done" | "expired" {
  const qi = card.answers.length;
  const q = card.questions[qi];
  card.answers.push({ label: q ? q.header || q.question || `Frage ${qi + 1}` : "Antwort", answer });

  const nextIndex = qi + 1;
  if (nextIndex < card.questions.length) {
    const answeredText = `${card.text}\n\n✅ ${clipText(answer, 300)}`;
    card.ready = card.ready
      .then(async () => {
        if (card.messageId != null) await editMessage(token, card.chatId, card.messageId, answeredText);
      })
      .catch((err) => console.error("[telegram] updating card failed", err));
    card.text = formatQuestionText(card.questions[nextIndex], nextIndex, card.questions.length);
    sendCardMessage(token, card, questionKeyboard(card.approvalId, card.questions[nextIndex], nextIndex));
    return "next";
  }

  card.outcome = `✅ Antwort: ${clipText(answer, 300)}`;
  if (!resolveApproval(card.approvalId, "deny", buildAnswerReason(card.answers))) {
    card.outcome = undefined;
    void finishCard(token, card, "⌛ Abgelaufen.");
    return "expired";
  }
  return "done";
}

/** A plain-text reply while a question or plan is open answers it. */
async function answerCardWithText(token: string, chatId: number, card: Card, text: string): Promise<void> {
  if (card.kind === "plan") {
    card.outcome = "📝 Änderungswunsch gesendet";
    const ok = resolveApproval(
      card.approvalId,
      "deny",
      `Der Nutzer hat den Plan abgelehnt und schreibt:\n${text}\nBitte überarbeite den Plan entsprechend.`
    );
    if (!ok) {
      card.outcome = undefined;
      await finishCard(token, card, "⌛ Abgelaufen.");
      await sendMessage(token, chatId, "⌛ Der Plan wartet nicht mehr auf eine Antwort.");
      return;
    }
    await sendMessage(token, chatId, "📨 Änderungswunsch übermittelt.");
    return;
  }
  const result = answerQuestion(token, card, text);
  if (result === "expired") await sendMessage(token, chatId, "⌛ Die Rückfrage wartet nicht mehr auf eine Antwort.");
  else if (result === "done") await sendMessage(token, chatId, "📨 Antwort übermittelt.");
  // "next": the following question was just posted — no extra message.
}

// --- Update handling ----------------------------------------------------------

const RUN_KIND_LABEL: Record<string, string> = { turn: "Einzelauftrag", loop: "Loop", orchestrate: "Orchestrierung" };
const SESSION_STATUS_LABEL: Record<string, string> = { idle: "bereit", running: "läuft", error: "Fehler" };

const HELP = [
  "🤖 CodeMaestro Assistant",
  "",
  "Schreib einfach deine Aufgabe — sie läuft in der gebundenen Session (auch in der PWA sichtbar).",
  "Freigaben, Rückfragen und Pläne kommen als Buttons; Rückfragen kannst du auch per Text beantworten.",
  "",
  "/new – neue Session im konfigurierten Verzeichnis",
  "/sessions – Sessions auflisten & wählen",
  `/loop [n] [Pause] <Aufgabe> – wiederholt die Aufgabe bis zu n-mal (Standard 10, max. ${LOOP_MAX_ITERATIONS}), bis der Agent <promise>${LOOP_PROMISE}</promise> meldet; Pause z. B. 30s, 10m, 1h`,
  "/kb <Frage> – Wissensbasis durchsuchen (RAG)",
  "/status – Status der Session und des laufenden Auftrags",
  "/stop – laufenden Auftrag abbrechen",
  "/whoami – deine Chat-ID (für die Allowlist)",
  "/help – diese Hilfe",
].join("\n");

async function handleMessage(token: string, config: TelegramConfig, msg: TgMessage) {
  const chatId = msg.chat.id;
  const { command, args } = parseCommand(msg.text || msg.caption || "");

  // /whoami works for everyone so a new user can learn their id to be allowlisted.
  if (command === "whoami") {
    await sendMessage(token, chatId, `Deine Chat-ID: ${chatId}\nFüge sie in den CodeMaestro-Einstellungen unter Telegram hinzu.`);
    return;
  }

  if (!isChatAllowed(chatId, config.allowedChatIds)) {
    await sendMessage(token, chatId, `🚫 Nicht autorisiert. Deine Chat-ID: ${chatId}\nLass sie in CodeMaestro → Settings → Telegram freischalten.`);
    return;
  }

  // Incoming image (photo or image document) → download it and hand the local
  // path to a turn so the assistant can Read/process it. Any caption becomes the
  // instruction; without one we fall back to a neutral note.
  const attach = pickAttachment(msg);
  if (attach) {
    // The file goes into the session's working directory (see UPLOAD_SUBDIR),
    // so the session is needed first — and nothing is written while an agent
    // runs in that folder.
    const sessionId = await getActiveSession(token, chatId, config);
    if (isSessionBusy(sessionId)) {
      await sendMessage(token, chatId, BUSY_TEXT);
      return;
    }
    const saved = await downloadTelegramFile(token, sessionId, attach.fileId, attach.ext);
    if (!saved) {
      await sendMessage(token, chatId, "⚠️ Bild konnte nicht heruntergeladen werden.");
      return;
    }
    const caption = (msg.caption || "").trim();
    const note = `Der Nutzer hat ein Bild über Telegram gesendet. Es wurde im Projektordner gespeichert unter:\n${saved}\nVerarbeite es bei Bedarf mit deinen Tools (z. B. Read).`;
    const prompt = caption ? `${caption}\n\n[${note}]` : note;
    await sendMessage(token, chatId, `🖼️ Bild empfangen (${path.basename(saved)}). Verarbeite…`);
    await startTelegramTurn(token, chatId, sessionId, prompt, config.useKnowledge);
    return;
  }

  switch (command) {
    case "start":
    case "help":
      await sendMessage(token, chatId, HELP);
      return;
    case "new": {
      const { id, cwd, notice } = await createSession(config);
      bindChat(chatId, id);
      await sendMessage(token, chatId, `🆕 Neue Session: ${id.slice(0, 8)} in ${cwd}${notice ? `\n${notice}` : ""}`);
      return;
    }
    case "sessions": {
      const list = await prisma.assistantSession.findMany({ orderBy: { updatedAt: "desc" }, take: 8 });
      if (!list.length) {
        await sendMessage(token, chatId, "Keine Sessions. /new zum Anlegen.");
        return;
      }
      const current = await boundSession(chatId);
      const rows: InlineKeyboard = [];
      for (const s of list) {
        const data = callbackData("use", s.id);
        if (!data) continue;
        const marks = `${s.id === current ? "• " : ""}${isSessionBusy(s.id) ? "⏳ " : ""}`;
        rows.push([{ text: buttonLabel(`${marks}${s.title || s.cwd} · ${s.id.slice(0, 6)}`, 56), callback_data: data }]);
      }
      await sendMessage(token, chatId, "Session wählen:", { reply_markup: { inline_keyboard: rows } });
      return;
    }
    case "status": {
      const sid = await boundSession(chatId);
      if (!sid) { await sendMessage(token, chatId, "Keine aktive Session. /new oder /sessions."); return; }
      const s = await prisma.assistantSession.findUnique({ where: { id: sid } });
      if (!s) { await sendMessage(token, chatId, "Session nicht mehr vorhanden."); return; }
      const run = getActiveRun(sid);
      const runLine = run
        ? `Auftrag: ${RUN_KIND_LABEL[run.kind] ?? run.kind} (gestartet über ${run.origin === "telegram" ? "Telegram" : "PWA"}, seit ${Math.max(0, Math.round((Date.now() - run.startedAt) / 60_000))} min)`
        : "Auftrag: keiner";
      const pending = listPending(sid).length;
      const lines = [
        `Session ${s.id.slice(0, 8)}${s.title ? ` – ${s.title}` : ""}`,
        `Status: ${SESSION_STATUS_LABEL[s.status] ?? s.status}`,
        runLine,
        ...(pending ? [`Offene Freigaben/Rückfragen: ${pending}`] : []),
        `Dir: ${s.cwd}`,
        `Provider: ${s.provider}${s.model ? ` (${s.model})` : ""}`,
        `Kosten: $${s.totalCostUsd.toFixed(4)}`,
      ];
      await sendMessage(token, chatId, lines.join("\n"));
      return;
    }
    case "stop": {
      const sid = await boundSession(chatId);
      if (sid && stopRunNow(sid).stopped) await sendMessage(token, chatId, "🛑 Wird gestoppt…");
      else await sendMessage(token, chatId, "Nichts zu stoppen.");
      return;
    }
    case "loop": {
      const parsed = parseLoopArgs(args);
      if (!parsed) {
        await sendMessage(
          token,
          chatId,
          `Nutzung: /loop [n] [Pause] <Aufgabe>\nn = max. Iterationen (1–${LOOP_MAX_ITERATIONS}, Standard 10), Pause z. B. 30s, 10m, 1h (max. 24h).\nBeispiel: /loop 5 Bring alle Tests zum Laufen`
        );
        return;
      }
      const sessionId = await getActiveSession(token, chatId, config);
      await startTelegramLoop(token, chatId, sessionId, parsed, config.useKnowledge);
      return;
    }
    case "kb": {
      // Explicit knowledge-base lookup — same shared retrieval path as the turns.
      const q = args.trim();
      if (!q) { await sendMessage(token, chatId, "Nutzung: /kb <Frage>"); return; }
      let hits;
      try {
        hits = await retrieveChunks(q, { topK: 4, minScore: 0.3 });
      } catch {
        await sendMessage(token, chatId, "⚠️ Wissensbasis nicht erreichbar (läuft Ollama mit dem Embedding-Modell?).");
        return;
      }
      if (!hits.length) {
        await sendMessage(token, chatId, "Nichts Relevantes in der Wissensbasis gefunden (oder Index leer).");
        return;
      }
      const text = hits
        .map((h, i) => `${i + 1}. ${h.docTitle} (${(h.score * 100).toFixed(0)}%)\n${clipText(h.content, 600, "…")}`)
        .join("\n\n");
      await sendMessage(token, chatId, `📚 Treffer für "${q}":\n\n${text}`);
      return;
    }
    default:
      if (command) {
        await sendMessage(token, chatId, `Unbekanntes Kommando /${command}. /help`);
        return;
      }
  }

  // Plain text → answers an open question/plan, otherwise runs as a turn.
  const prompt = args.trim();
  if (!prompt) return;
  const card = openQuestionCard(chatId);
  if (card) {
    await answerCardWithText(token, chatId, card, prompt);
    return;
  }
  const sessionId = await getActiveSession(token, chatId, config);
  await startTelegramTurn(token, chatId, sessionId, prompt, config.useKnowledge);
}

async function handleCallback(token: string, config: TelegramConfig, cq: TgCallbackQuery) {
  const chatId = cq.message?.chat.id;
  const data = cq.data || "";
  const reply = (text?: string) =>
    tg(token, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text: sliceHead(text, 190) } : {}) });

  if (chatId == null || !isChatAllowed(chatId, config.allowedChatIds)) {
    await reply("Nicht autorisiert.");
    return;
  }
  const [prefix, ...parts] = data.split(":");

  // Buttons of a card that no longer exists (resolved, expired, restarted).
  const stale = async () => {
    await reply("Nicht mehr aktiv.");
    if (cq.message) await editMessage(token, chatId, cq.message.message_id, `${cq.message.text || ""}\n\n⌛ Nicht mehr aktiv.`);
  };

  if (prefix === "apr" || prefix === "pl") {
    const [approvalId, decision] = parts;
    const card = cardFor(approvalId, chatId);
    const expected = prefix === "apr" ? "approval" : "plan";
    if (!card || card.kind !== expected) { await stale(); return; }
    const allow = decision === "allow";
    if (prefix === "apr") card.outcome = allow ? "✅ Erlaubt" : "🚫 Abgelehnt";
    else card.outcome = allow ? "✅ Plan wird umgesetzt" : "🚫 Plan abgelehnt";
    const reason = prefix === "pl" && !allow ? PLAN_REJECT_REASON : undefined;
    // Resolving publishes approval_resolved → the run mirror updates the card.
    const ok = resolveApproval(approvalId, allow ? "allow" : "deny", reason);
    if (!ok) card.outcome = undefined;
    await reply(ok ? (allow ? "Erlaubt" : "Abgelehnt") : "Abgelaufen");
    if (!ok) await finishCard(token, card, "⌛ Abgelaufen.");
    return;
  }

  if (prefix === "q") {
    const [approvalId, qiRaw, oiRaw] = parts;
    const card = cardFor(approvalId, chatId);
    if (!card || card.kind !== "ask") { await stale(); return; }
    const qi = Number(qiRaw);
    const option = card.questions[qi]?.options[Number(oiRaw)];
    if (qi !== card.answers.length || !option) { await reply("Bereits beantwortet."); return; }
    const result = answerQuestion(token, card, option.label);
    await reply(result === "expired" ? "Abgelaufen" : option.label);
    return;
  }

  if (prefix === "use") {
    const sid = parts.join(":");
    const row = await prisma.assistantSession.findUnique({ where: { id: sid }, select: { cwd: true } });
    if (row) {
      bindChat(chatId, sid);
      await reply("Gewählt");
      await sendMessage(token, chatId, `✅ Aktive Session: ${sid.slice(0, 8)} (${row.cwd})`);
    } else {
      await reply("Session nicht mehr vorhanden");
    }
    return;
  }
  await reply();
}

// --- Long-poll loop -----------------------------------------------------------

/**
 * Polls getUpdates for one bridge generation. Handlers never block the poll:
 * callbacks run immediately, messages run in a per-chat queue (so /new followed
 * by a task keeps its order), and turns are detached runs.
 */
async function pollLoop(token: string, gen: number, signal: AbortSignal): Promise<void> {
  const s = state();
  const chatQueues = new Map<number, Promise<void>>();
  const enqueue = (chatId: number, job: () => Promise<void>) => {
    const next = (chatQueues.get(chatId) ?? Promise.resolve())
      .then(job)
      .catch(async (err) => {
        // E.g. /new with a working directory that is no longer allowed.
        console.error("[telegram] message handling failed", err);
        await sendMessage(token, chatId, `⚠️ Fehler: ${clipText(err instanceof Error ? err.message : String(err), 500)}`);
      })
      .catch(() => {});
    chatQueues.set(chatId, next);
    void next.finally(() => {
      if (chatQueues.get(chatId) === next) chatQueues.delete(chatId);
    });
  };

  let backoff = 1500;
  while (s.generation === gen) {
    const res = await tgCall<TgUpdate[]>(
      token,
      "getUpdates",
      { offset: s.offset, timeout: POLL_TIMEOUT_SEC, allowed_updates: ["message", "callback_query"] },
      AbortSignal.any([signal, AbortSignal.timeout((POLL_TIMEOUT_SEC + 15) * 1000)])
    );
    if (s.generation !== gen) break;
    if (!res.ok) {
      // Network hiccup, conflict with another poller, … — back off, then
      // re-read the config (token may have changed / bridge disabled).
      s.error = res.description;
      await pause(backoff, signal);
      backoff = Math.min(backoff * 2, 30_000);
      if (s.generation !== gen) break;
      const cfg = await getTelegramConfig();
      if (!cfg.enabled || !cfg.token || cfg.token !== token) break;
      continue;
    }
    backoff = 1500;
    s.error = "";
    if (!res.result.length) continue;

    // Re-read config each batch so changes from the PWA take effect live.
    const cfg = await getTelegramConfig();
    if (s.generation !== gen) break;
    for (const u of res.result) {
      s.offset = Math.max(s.offset, u.update_id + 1);
      if (u.callback_query) {
        const cq = u.callback_query;
        void handleCallback(token, cfg, cq).catch((err) => console.error("[telegram] callback failed", err));
      } else if (u.message && (u.message.text || u.message.photo || u.message.document)) {
        const msg = u.message;
        enqueue(msg.chat.id, () => handleMessage(token, cfg, msg));
      }
    }
  }
}

// --- Public control -----------------------------------------------------------

const START_RETRY_MS = 30_000;

/**
 * Retries a start that failed only because Telegram was unreachable (e.g. the
 * server booted before the network was up). Gives up as soon as anything else
 * starts or stops the bridge in the meantime.
 */
function scheduleStartRetry(gen: number): void {
  const t = setTimeout(() => {
    const s = state();
    if (s.generation === gen && !s.running && !s.starting) void startBridge();
  }, START_RETRY_MS);
  (t as { unref?: () => void }).unref?.();
}

async function doStart(gen: number): Promise<StartResult> {
  const s = state();
  const config = await getTelegramConfig();
  if (!config.enabled) return { ok: false, error: "Telegram-Bridge ist deaktiviert." };
  if (!config.token) return { ok: false, error: "Kein Bot-Token konfiguriert." };

  const me = await tgCall<{ id?: number; username?: string }>(config.token, "getMe");
  if (s.generation !== gen) return { ok: false, error: "Start abgebrochen." };
  if (!me.ok) {
    if (me.transient) {
      s.error = `Telegram nicht erreichbar (${me.description}) — neuer Versuch in ${START_RETRY_MS / 1000} s.`;
      scheduleStartRetry(gen);
    } else {
      s.error = `Bot-Token ungültig: ${me.description}`;
    }
    return { ok: false, error: s.error };
  }
  void loadBindings();
  // A different bot has its own update ids.
  const bot = me.result;
  if (bot.id && bot.id !== s.botId) {
    s.botId = bot.id;
    s.offset = 0;
  }
  s.botUsername = bot.username || "";
  s.error = "";
  s.running = true;
  s.startedAt = Date.now();
  const abort = new AbortController();
  s.abort = abort;
  // Fire the loop without awaiting; it runs for this generation's lifetime.
  void pollLoop(config.token, gen, abort.signal)
    .catch((err) => {
      console.error("[telegram] poll loop crashed", err);
      if (s.generation === gen) s.error = err instanceof Error ? err.message : "Bridge-Fehler";
    })
    .finally(() => {
      // Only clear state that still belongs to this generation — a newer
      // bridge may already be running.
      if (s.generation === gen) {
        s.running = false;
        s.abort = null;
      }
    });
  return { ok: true };
}

/** Starts the bridge from the current config. Idempotent; safe to call on boot. */
export function startBridge(): Promise<StartResult> {
  const s = state();
  if (s.running) return Promise.resolve({ ok: true });
  if (s.starting) return s.starting;
  const gen = ++s.generation;
  const p: Promise<StartResult> = doStart(gen)
    .catch((err): StartResult => ({ ok: false, error: err instanceof Error ? err.message : "Start fehlgeschlagen." }))
    .finally(() => {
      if (s.starting === p) s.starting = null;
    });
  s.starting = p;
  return p;
}

/** Stops the bridge and aborts any in-flight long poll. Runs keep going. */
export function stopBridge(): void {
  const s = state();
  s.generation++;
  s.running = false;
  s.starting = null;
  s.abort?.abort();
  s.abort = null;
}

/** Validates a token against Telegram without starting the loop. */
export async function testToken(token: string): Promise<{ ok: boolean; username?: string }> {
  const me = await tg<{ username?: string }>(token, "getMe");
  return me ? { ok: true, username: me.username } : { ok: false };
}
