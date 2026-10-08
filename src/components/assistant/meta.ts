// Transcript rows carry their details as a JSON string in `meta` (the same
// shape for persisted and live rows). Rows are immutable, so the parsed object
// is cached per row: the thread is rebuilt on every streamed chunk and must not
// re-parse large tool inputs (whole files for Write) each time.
import type { Msg } from "./types";

/** Fields the UI reads from `meta`, all optional and unchecked. */
export interface RowMeta {
  // tool_use / tool_result
  name?: string;
  input?: unknown;
  toolUseId?: string;
  isError?: boolean;
  // knowledge
  sources?: string[];
  // orchestrator rows
  subtaskId?: string;
  title?: string;
  worker?: string;
  workerId?: string;
  roleId?: string;
  roleName?: string;
  review?: boolean;
  round?: number;
  maxRounds?: number;
  verdict?: string;
  fixRound?: number;
  subtasks?: unknown[];
  roles?: { id: string; name: string; editsFiles?: boolean }[];
  // loop rows
  loop?: Record<string, unknown>;
  loopEnd?: string;
  iterations?: number;
  iteration?: number;
  maxIterations?: number;
  freshContext?: boolean;
  resumeAt?: number;
  [key: string]: unknown;
}

const cache = new WeakMap<Msg, RowMeta>();

export function parseMeta(meta: string | undefined): RowMeta {
  if (!meta) return {};
  try {
    const v: unknown = JSON.parse(meta);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as RowMeta) : {};
  } catch {
    return {};
  }
}

/** The parsed `meta` of a row (cached per row object). */
export function metaOf(msg: Msg): RowMeta {
  let m = cache.get(msg);
  if (!m) {
    m = parseMeta(msg.meta);
    cache.set(msg, m);
  }
  return m;
}

/** A live row whose parsed meta is known up front (primes the cache). */
export function row(msg: Omit<Msg, "meta">, meta?: RowMeta): Msg {
  const out: Msg = meta ? { ...msg, meta: JSON.stringify(meta) } : { ...msg };
  if (meta) cache.set(out, meta);
  return out;
}

/** Time of a row in epoch ms (live `at` or persisted `createdAt`), if known. */
export function rowTime(msg: Msg): number | undefined {
  if (typeof msg.at === "number" && Number.isFinite(msg.at)) return msg.at;
  if (msg.createdAt) {
    const t = Date.parse(msg.createdAt);
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}
