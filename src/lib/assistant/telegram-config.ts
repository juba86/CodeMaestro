import { prisma } from "@/lib/db/client";

// Persisted Telegram bridge configuration. Stored as a single JSON blob in the
// Setting table (server-side only — the bot token never lives in the browser).
// The PWA is the primary front-end; Telegram is an optional fallback for driving
// the assistant when you are away from the Tailscale network.
export interface TelegramConfig {
  enabled: boolean;
  token: string; // bot token from @BotFather
  allowedChatIds: number[]; // only these Telegram chats may drive the bot
  cwd: string; // working directory the Telegram-bound session runs in
  permissionMode: string; // default | acceptEdits | plan | bypassPermissions
  approvalMode: string; // off | edits | all
  provider: string; // claude | gemini | ...
  model: string;
  useKnowledge: boolean; // augment turns with knowledge-base context (RAG)
}

const SETTING_KEY = "telegramConfig";

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
  token: "",
  allowedChatIds: [],
  cwd: "",
  permissionMode: "default",
  approvalMode: "edits",
  provider: "claude",
  model: "",
  useKnowledge: true,
};

export async function getTelegramConfig(): Promise<TelegramConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_TELEGRAM_CONFIG };
    const parsed = JSON.parse(row.value) as Partial<TelegramConfig>;
    return { ...DEFAULT_TELEGRAM_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }
}

export async function saveTelegramConfig(
  patch: Partial<TelegramConfig>
): Promise<TelegramConfig> {
  const current = await getTelegramConfig();
  const next: TelegramConfig = { ...current, ...patch };
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  });
  return next;
}

// Never expose the full token to the client. Show only enough to confirm which
// token is stored.
export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

// The config shape sent to the browser (token masked, presence flagged).
export interface TelegramConfigPublic {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked: string;
  allowedChatIds: number[];
  cwd: string;
  permissionMode: string;
  approvalMode: string;
  provider: string;
  model: string;
  useKnowledge: boolean;
}

export function toPublicConfig(c: TelegramConfig): TelegramConfigPublic {
  return {
    enabled: c.enabled,
    hasToken: !!c.token,
    tokenMasked: maskToken(c.token),
    allowedChatIds: c.allowedChatIds,
    cwd: c.cwd,
    permissionMode: c.permissionMode,
    approvalMode: c.approvalMode,
    provider: c.provider,
    model: c.model,
    useKnowledge: c.useKnowledge,
  };
}
