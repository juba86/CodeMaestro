// Client calls for the orchestra configuration (DESIGN.md §6.3.1). Errors carry
// the server's German message; network failures get a German fallback.

import type {
  OrchestraConfig,
  OrchestraPresetId,
  OrchestraWorkerInfo,
} from "@/lib/assistant/orchestra-types";

export type ClientProviders = { id: string; key: string; baseUrl: string }[];

export class OrchestraApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OrchestraApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new OrchestraApiError("Server nicht erreichbar.", 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${fallback} (HTTP ${res.status})`;
    throw new OrchestraApiError(message, res.status);
  }
  if (body === null) throw new OrchestraApiError(`${fallback} (leere Antwort)`, res.status);
  return body as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** GET /api/orchestra → the saved configuration (defaults when nothing is saved). */
export async function fetchOrchestraConfig(signal?: AbortSignal): Promise<OrchestraConfig> {
  const d = await request<{ config?: OrchestraConfig }>(
    "/api/orchestra",
    { signal },
    "Orchester-Konfiguration konnte nicht geladen werden."
  );
  if (!d.config) throw new OrchestraApiError("Orchester-Konfiguration konnte nicht geladen werden.", 200);
  return d.config;
}

/** POST /api/assistant/orchestrate/workers → the models available right now. */
export async function fetchOrchestraWorkers(
  clientProviders: ClientProviders,
  signal?: AbortSignal
): Promise<OrchestraWorkerInfo[]> {
  const d = await request<{ workers?: OrchestraWorkerInfo[] }>(
    "/api/assistant/orchestrate/workers",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ clientProviders }), signal },
    "Modelle konnten nicht geprüft werden."
  );
  return Array.isArray(d.workers) ? d.workers : [];
}

/** PUT /api/orchestra → the saved (normalized) configuration. */
export async function putOrchestraConfig(config: OrchestraConfig): Promise<OrchestraConfig> {
  const d = await request<{ config?: OrchestraConfig }>(
    "/api/orchestra",
    { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ config }) },
    "Orchester-Konfiguration konnte nicht gespeichert werden."
  );
  if (!d.config) throw new OrchestraApiError("Orchester-Konfiguration konnte nicht gespeichert werden.", 200);
  return d.config;
}

/** POST /api/orchestra/preset → assignments for a preset from the workers available now (NOT saved). */
export async function postOrchestraPreset(
  preset: OrchestraPresetId,
  clientProviders: ClientProviders,
  config?: OrchestraConfig | null
): Promise<{ config: OrchestraConfig; warnings: string[] }> {
  const d = await request<{ config?: OrchestraConfig; warnings?: string[] }>(
    "/api/orchestra/preset",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ preset, clientProviders, ...(config ? { config } : {}) }),
    },
    "Voreinstellung konnte nicht berechnet werden."
  );
  if (!d.config) throw new OrchestraApiError("Voreinstellung konnte nicht berechnet werden.", 200);
  return { config: d.config, warnings: Array.isArray(d.warnings) ? d.warnings : [] };
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
