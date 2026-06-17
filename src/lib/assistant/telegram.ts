import { prisma } from "@/lib/db/client";
import { runTurn, stopSession, isRunning, type AssistantSessionRow, type NormalizedEvent } from "./runner";
import { resolveWorkdir } from "./security";
import {
  registerEmitter,
  unregisterEmitter,
  resolveApproval,
  type ApprovalEvent,
} from "./approvals";
import { getTelegramConfig, type TelegramConfig } from "./telegram-config";
import { splitForTelegram, parseCommand, isChatAllowed, formatToolLine, MAX_MSG } from "./telegram-format";
import { augmentPromptWithKnowledge, retrieveChunks } from "@/lib/knowledge/retrieve";
import { promises as fs } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Telegram bridge: an optional, long-poll-based front-end onto the SAME session
// engine the PWA uses (runner.runTurn + approvals.resolveApproval). It lets you
// drive the code assistant from Telegram when you are away from the Tailscale
// network. Long-polling (getUpdates) is used because the server is private and
// has no public webhook URL.
// ---------------------------------------------------------------------------

const TG_API = "https://api.telegram.org";
const EDIT_THROTTLE_MS = 2500; // min interval between streaming edits

export { splitForTelegram, parseCommand, isChatAllowed, formatToolLine };

// --- Telegram API calls -------------------------------------------------------

async function tg<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal,
    });
    const data = await res.json();
    if (!data.ok) return null;
    return data.result as T;
  } catch {
    return null;
  }
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

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<number | null> {
  const chunks = splitForTelegram(text);
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

async function editMessage(token: string, chatId: number, messageId: number, text: string) {
  await tg(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, MAX_MSG),
  });
}

// --- Incoming media -----------------------------------------------------------

// Where downloaded Telegram attachments are stored. Inside the app dir so it sits
// within the assistant's allowed working tree; the absolute path is handed to the
// turn so the assistant can Read/process it.
const UPLOAD_DIR = path.join(process.cwd(), "telegram-uploads");

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
// UPLOAD_DIR. Returns the absolute local path, or null on any failure.
async function downloadTelegramFile(token: string, fileId: string, ext: string): Promise<string | null> {
  try {
    const info = await tg<{ file_path?: string }>(token, "getFile", { file_id: fileId });
    if (!info?.file_path) return null;
    const res = await fetch(`${TG_API}/file/bot${token}/${info.file_path}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const dest = path.join(UPLOAD_DIR, `tg_${stamp}${ext || ".bin"}`);
    await fs.writeFile(dest, buf);
    return dest;
  } catch {
    return null;
  }
}

// --- Bridge state -------------------------------------------------------------

interface BridgeState {
  running: boolean;
  startedAt: number;
  offset: number;
  abort: AbortController | null;
  error: string;
  botUsername: string;
  // Which assistant session each chat is bound to.
  chatSessions: Map<number, string>;
}

// Survive HMR / repeated instrumentation calls in dev with a global singleton.
const g = globalThis as unknown as { __tgBridge?: BridgeState };
function state(): BridgeState {
  if (!g.__tgBridge) {
    g.__tgBridge = {
      running: false,
      startedAt: 0,
      offset: 0,
      abort: null,
      error: "",
      botUsername: "",
      chatSessions: new Map(),
    };
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

// --- Session helpers ----------------------------------------------------------

async function createSession(config: TelegramConfig): Promise<string> {
  const cwd = await resolveWorkdir(config.cwd);
  const session = await prisma.assistantSession.create({
    data: {
      provider: config.provider || "claude",
      model: config.model || "",
      title: "Telegram",
      cwd,
      permissionMode: config.permissionMode || "default",
      allowedTools: "Read,Grep,Glob,Edit,Write,Bash",
      approvalMode: config.approvalMode || "edits",
      sandbox: false,
    },
  });
  return session.id;
}

async function getActiveSession(chatId: number, config: TelegramConfig): Promise<string> {
  const s = state();
  const existing = s.chatSessions.get(chatId);
  if (existing) {
    const row = await prisma.assistantSession.findUnique({ where: { id: existing } });
    if (row) return existing;
  }
  const id = await createSession(config);
  s.chatSessions.set(chatId, id);
  return id;
}

// Runs one assistant turn for a chat, streaming progress back to Telegram and
// routing tool approvals to inline buttons. Reuses the exact runner + approval
// machinery the PWA uses.
async function runTelegramTurn(token: string, chatId: number, sessionId: string, prompt: string, useKnowledge: boolean) {
  const session = await prisma.assistantSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    await sendMessage(token, chatId, "⚠️ Session nicht gefunden. /new für eine neue.");
    return;
  }
  if (session.status === "running" || isRunning(session.id)) {
    await sendMessage(token, chatId, "⏳ In dieser Session läuft bereits eine Aufgabe. /stop zum Abbrechen.");
    return;
  }
  try {
    await resolveWorkdir(session.cwd);
  } catch (err) {
    await sendMessage(token, chatId, `⚠️ Arbeitsverzeichnis ungültig: ${err instanceof Error ? err.message : "?"}`);
    return;
  }

  await prisma.assistantMessage.create({ data: { sessionId, role: "user", content: prompt } });
  await prisma.assistantSession.update({
    where: { id: sessionId },
    data: { status: "running", title: session.title || prompt.slice(0, 80) },
  });

  // Streaming message we keep editing as text arrives (throttled).
  const statusMsgId = await sendMessage(token, chatId, "💭 …");
  let buffer = "";
  let lastEdit = 0;
  let assistantText = "";
  const toPersist: { role: string; content: string; meta: string }[] = [];

  const flush = async (force = false) => {
    if (statusMsgId == null) return;
    const now = Date.now();
    if (!force && now - lastEdit < EDIT_THROTTLE_MS) return;
    lastEdit = now;
    const shown = buffer.slice(-MAX_MSG) || "💭 …";
    await editMessage(token, chatId, statusMsgId, shown);
  };

  // Approval requests for this session arrive here while the turn streams.
  const onApproval = (e: ApprovalEvent) => {
    if (e.type !== "approval_request") return;
    const head = e.tool === "Bash"
      ? `🔸 Freigabe (Bash): ${(e.command || "").slice(0, 500)}`
      : `🔸 Freigabe: ${e.tool} ${e.filePath || ""}`;
    const diffPreview = (e.diff || [])
      .map((d) => (d.op === "add" ? "+ " : d.op === "del" ? "- " : "  ") + d.text)
      .join("\n")
      .slice(0, 1500);
    const text = diffPreview ? `${head}\n\n${diffPreview}` : head;
    void sendMessage(token, chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Erlauben", callback_data: `apr:${e.approvalId}:allow` },
          { text: "🚫 Ablehnen", callback_data: `apr:${e.approvalId}:deny` },
        ]],
      },
    });
  };
  registerEmitter(sessionId, onApproval);

  const emit = (ev: NormalizedEvent) => {
    if (ev.type === "text" && ev.content) {
      assistantText += ev.content;
      buffer += ev.content;
      void flush();
    } else if (ev.type === "tool_use") {
      const line = `\n${formatToolLine(ev.name, ev.input)}\n`;
      buffer += line;
      toPersist.push({ role: "tool_use", content: ev.name || "tool", meta: JSON.stringify({ name: ev.name, input: ev.input, toolUseId: ev.toolUseId }) });
      void flush();
    } else if (ev.type === "tool_result") {
      toPersist.push({ role: "tool_result", content: (ev.content || "").slice(0, 8000), meta: JSON.stringify({ toolUseId: ev.toolUseId, isError: ev.isError }) });
    } else if (ev.type === "error" && ev.content) {
      toPersist.push({ role: "error", content: ev.content.slice(0, 4000), meta: "{}" });
    }
  };

  // RAG: prepend relevant knowledge-base context via the SAME shared retrieval
  // path the Code Assistant uses. Graceful no-op when disabled, the index is
  // empty, or Ollama is down — so the turn always runs.
  let effectivePrompt = prompt;
  try {
    const aug = await augmentPromptWithKnowledge(prompt, { enabled: useKnowledge });
    if (aug.injected) {
      effectivePrompt = aug.prompt;
      buffer += `📚 Wissensbasis: ${aug.sources.length} Quelle(n) (${aug.sources.map((s) => s.docTitle).join(", ")})\n`;
      void flush();
    }
  } catch { /* never let RAG block the turn */ }

  let result: { externalId: string | null; costUsd: number; isError: boolean };
  try {
    const row: AssistantSessionRow = {
      id: session.id,
      externalId: session.externalId,
      provider: session.provider,
      model: session.model,
      cwd: session.cwd,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
      approvalMode: session.approvalMode,
      sandbox: session.sandbox,
    };
    result = await runTurn(row, effectivePrompt, undefined, emit);
  } catch (err) {
    result = { externalId: session.externalId, costUsd: 0, isError: true };
    buffer += `\n⚠️ ${err instanceof Error ? err.message : "Runner-Fehler"}`;
  } finally {
    unregisterEmitter(sessionId);
  }

  // Persist transcript (mirrors the PWA message route).
  const rows: { sessionId: string; role: string; content: string; meta: string }[] = [];
  if (assistantText.trim()) rows.push({ sessionId, role: "assistant", content: assistantText.trim(), meta: "{}" });
  for (const p of toPersist) rows.push({ sessionId, ...p });
  if (rows.length) await prisma.assistantMessage.createMany({ data: rows });

  await prisma.assistantSession.update({
    where: { id: sessionId },
    data: {
      status: result.isError ? "error" : "idle",
      externalId: result.externalId ?? session.externalId,
      totalCostUsd: { increment: result.costUsd || 0 },
    },
  });

  // Final output: replace the streaming bubble with the full answer.
  await flush(true);
  const final = assistantText.trim() || "(kein Textoutput)";
  const cost = result.costUsd ? ` · $${result.costUsd.toFixed(4)}` : "";
  await sendMessage(token, chatId, `${result.isError ? "⚠️ " : "✅ "}${final}${cost}`);
}

// --- Update handling ----------------------------------------------------------

const HELP = [
  "🤖 *CodeMaestro Assistant*",
  "",
  "Schreib einfach deine Aufgabe — sie läuft in der gebundenen Session.",
  "",
  "/new – neue Session im konfigurierten Verzeichnis",
  "/sessions – Sessions auflisten & wählen",
  "/kb <Frage> – Wissensbasis durchsuchen (RAG)",
  "/status – Status der aktiven Session",
  "/stop – laufende Aufgabe abbrechen",
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
    const saved = await downloadTelegramFile(token, attach.fileId, attach.ext);
    if (!saved) {
      await sendMessage(token, chatId, "⚠️ Bild konnte nicht heruntergeladen werden.");
      return;
    }
    const caption = (msg.caption || "").trim();
    const note = `Der Nutzer hat ein Bild über Telegram gesendet. Es wurde lokal gespeichert unter:\n${saved}\nVerarbeite es bei Bedarf mit deinen Tools (z. B. Read).`;
    const prompt = caption ? `${caption}\n\n[${note}]` : note;
    await sendMessage(token, chatId, `🖼️ Bild empfangen (${path.basename(saved)}). Verarbeite…`);
    const sessionId = await getActiveSession(chatId, config);
    await runTelegramTurn(token, chatId, sessionId, prompt, config.useKnowledge);
    return;
  }

  switch (command) {
    case "start":
    case "help":
      await sendMessage(token, chatId, HELP);
      return;
    case "new": {
      const id = await createSession(config);
      state().chatSessions.set(chatId, id);
      await sendMessage(token, chatId, `🆕 Neue Session: ${id.slice(0, 8)} in ${config.cwd}`);
      return;
    }
    case "sessions": {
      const list = await prisma.assistantSession.findMany({ orderBy: { updatedAt: "desc" }, take: 8 });
      if (!list.length) {
        await sendMessage(token, chatId, "Keine Sessions. /new zum Anlegen.");
        return;
      }
      await sendMessage(token, chatId, "Session wählen:", {
        reply_markup: {
          inline_keyboard: list.map((s) => [
            { text: `${s.status === "running" ? "⏳ " : ""}${(s.title || s.cwd).slice(0, 40)} · ${s.id.slice(0, 6)}`, callback_data: `use:${s.id}` },
          ]),
        },
      });
      return;
    }
    case "status": {
      const sid = state().chatSessions.get(chatId);
      if (!sid) { await sendMessage(token, chatId, "Keine aktive Session. /new oder /sessions."); return; }
      const s = await prisma.assistantSession.findUnique({ where: { id: sid } });
      if (!s) { await sendMessage(token, chatId, "Session nicht mehr vorhanden."); return; }
      await sendMessage(token, chatId, `Session ${s.id.slice(0, 8)}\nStatus: ${s.status}\nDir: ${s.cwd}\nProvider: ${s.provider}\nKosten: $${s.totalCostUsd.toFixed(4)}`);
      return;
    }
    case "stop": {
      const sid = state().chatSessions.get(chatId);
      if (sid && stopSession(sid)) await sendMessage(token, chatId, "🛑 Gestoppt.");
      else await sendMessage(token, chatId, "Nichts zu stoppen.");
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
        .map((h, i) => `*${i + 1}. ${h.docTitle}* (${(h.score * 100).toFixed(0)}%)\n${h.content.slice(0, 600)}`)
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

  // Plain text → run it as a turn.
  const prompt = args.trim();
  if (!prompt) return;
  const sessionId = await getActiveSession(chatId, config);
  await runTelegramTurn(token, chatId, sessionId, prompt, config.useKnowledge);
}

async function handleCallback(token: string, config: TelegramConfig, cq: TgCallbackQuery) {
  const chatId = cq.message?.chat.id;
  const data = cq.data || "";
  if (chatId == null || !isChatAllowed(chatId, config.allowedChatIds)) {
    await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Nicht autorisiert." });
    return;
  }
  if (data.startsWith("apr:")) {
    const [, approvalId, decision] = data.split(":");
    const ok = resolveApproval(approvalId, decision === "allow" ? "allow" : "deny");
    await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: ok ? (decision === "allow" ? "Erlaubt" : "Abgelehnt") : "Abgelaufen" });
    if (cq.message) {
      await editMessage(token, chatId, cq.message.message_id, `${cq.message.text || ""}\n\n${decision === "allow" ? "✅ Erlaubt" : "🚫 Abgelehnt"}`);
    }
    return;
  }
  if (data.startsWith("use:")) {
    const sid = data.slice(4);
    const row = await prisma.assistantSession.findUnique({ where: { id: sid } });
    if (row) {
      state().chatSessions.set(chatId, sid);
      await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Gewählt" });
      await sendMessage(token, chatId, `✅ Aktive Session: ${sid.slice(0, 8)} (${row.cwd})`);
    } else {
      await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Weg" });
    }
    return;
  }
  await tg(token, "answerCallbackQuery", { callback_query_id: cq.id });
}

// --- Long-poll loop -----------------------------------------------------------

async function loop(token: string) {
  const s = state();
  while (s.running) {
    const updates = await tg<TgUpdate[]>(
      token,
      "getUpdates",
      { offset: s.offset, timeout: 30, allowed_updates: ["message", "callback_query"] },
      s.abort?.signal
    );
    if (!s.running) break;
    if (!updates) {
      // Network hiccup or aborted — back off briefly, re-read config (token may
      // have changed / bridge disabled).
      await new Promise((r) => setTimeout(r, 1500));
      const cfg = await getTelegramConfig();
      if (!cfg.enabled || !cfg.token) { s.running = false; break; }
      continue;
    }
    for (const u of updates) {
      s.offset = Math.max(s.offset, u.update_id + 1);
      // Re-read config each batch so changes from the PWA take effect live.
      const cfg = await getTelegramConfig();
      try {
        if (u.message?.text || u.message?.photo || u.message?.document) await handleMessage(token, cfg, u.message);
        else if (u.callback_query) await handleCallback(token, cfg, u.callback_query);
      } catch {
        /* never let one bad update kill the loop */
      }
    }
  }
}

// --- Public control -----------------------------------------------------------

/** Starts the bridge from the current config. Idempotent; safe to call on boot. */
export async function startBridge(): Promise<{ ok: boolean; error?: string }> {
  const s = state();
  if (s.running) return { ok: true };
  const config = await getTelegramConfig();
  if (!config.enabled) return { ok: false, error: "Telegram-Bridge ist deaktiviert." };
  if (!config.token) return { ok: false, error: "Kein Bot-Token konfiguriert." };

  const me = await tg<{ username?: string }>(config.token, "getMe");
  if (!me) {
    s.error = "Bot-Token ungültig oder Telegram nicht erreichbar.";
    return { ok: false, error: s.error };
  }
  s.botUsername = me.username || "";
  s.error = "";
  s.running = true;
  s.startedAt = Date.now();
  s.abort = new AbortController();
  // Fire the loop without awaiting; it runs for the bridge's lifetime.
  void loop(config.token).finally(() => {
    s.running = false;
    s.abort = null;
  });
  return { ok: true };
}

/** Stops the bridge and aborts any in-flight long poll. */
export function stopBridge(): void {
  const s = state();
  s.running = false;
  s.abort?.abort();
  s.abort = null;
}

/** Validates a token against Telegram without starting the loop. */
export async function testToken(token: string): Promise<{ ok: boolean; username?: string }> {
  const me = await tg<{ username?: string }>(token, "getMe");
  return me ? { ok: true, username: me.username } : { ok: false };
}
