import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

// GitHub account connection (server only). Lets assistant CLI runs push and use
// `gh` without any credentials in the working tree: the token is stored
// encrypted in the Setting table and handed to each CLI run through env vars
// (GH_TOKEN for gh, an inline git credential helper that reads it from env).
// The token is never sent to the browser.

const SETTING_KEY = "github";
const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "CodeMaestro";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const TIMEOUT_MS = 15_000;
// Push (incl. private repos), edit .github/workflows, see org repos.
export const DEVICE_SCOPES = "repo workflow read:org";

/**
 * Hosts git/gh need for clone/fetch/push, API calls and release/LFS downloads.
 * Added to Claude Code's sandbox network allow-list when the sandbox is on.
 * `*.github.com` does not match `github.com` itself, so both are listed.
 */
export const GITHUB_SANDBOX_DOMAINS = [
  "github.com",
  "*.github.com",
  "api.github.com",
  "codeload.github.com",
  "*.githubusercontent.com",
  "objects.githubusercontent.com",
];

export type GithubMethod = "device" | "token";
export type GithubTokenKind = "classic" | "fine-grained" | "oauth" | "app" | "unknown";

interface GithubStored {
  // Connection (absent when disconnected)
  tokenEnc?: string;
  method?: GithubMethod;
  tokenKind?: GithubTokenKind;
  login?: string;
  name?: string | null;
  id?: number;
  avatarUrl?: string;
  email?: string | null; // public profile email, display only
  scopes?: string[];
  connectedAt?: string;
  // Expiring tokens (GitHub App user tokens / apps that opted in)
  tokenExpiresAt?: string;
  refreshTokenEnc?: string;
  refreshExpiresAt?: string;
  refreshClientId?: string;
  // Options (survive a disconnect)
  injectIntoAssistant: boolean;
  gitIdentity: boolean;
  oauthClientId?: string;
}

const DEFAULTS: GithubStored = { injectIntoAssistant: true, gitIdentity: true };

/** What the browser gets. Never contains a token. */
export interface GithubStatus {
  connected: boolean;
  /** false when a token is stored but can't be decrypted (secret key changed) — reconnect. */
  tokenReadable: boolean;
  method: GithubMethod | null;
  tokenKind: GithubTokenKind | null;
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
  /** An expiring token can be renewed with the stored refresh token. */
  autoRefresh: boolean;
  warnings: string[];
  injectIntoAssistant: boolean;
  gitIdentity: boolean;
  oauthClientId: string;
  /** GITHUB_OAUTH_CLIENT_ID is set on the server (device flow works without entering one). */
  envClientId: boolean;
}

/** Error with a German, user-facing message and the HTTP status a route should use. */
export class GithubError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "GITHUB_ERROR") {
    super(message);
  }
}

export function githubErrorInfo(err: unknown): { status: number; error: string; code: string } {
  if (err instanceof GithubError) return { status: err.status, error: err.message, code: err.code };
  // Unexpected errors (DB, crypto …) stay in the server log: their messages can
  // echo query arguments and aren't meant for the browser.
  console.error("[github]", err);
  return { status: 500, error: "Interner Fehler bei der GitHub-Verbindung (Details im Server-Log).", code: "INTERNAL" };
}

// --- Storage ---------------------------------------------------------------

async function readStored(): Promise<GithubStored> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<GithubStored>) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function writeStored(next: GithubStored): Promise<void> {
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
}

function withoutConnection(s: GithubStored): GithubStored {
  return {
    injectIntoAssistant: s.injectIntoAssistant,
    gitIdentity: s.gitIdentity,
    ...(s.oauthClientId ? { oauthClientId: s.oauthClientId } : {}),
  };
}

function isConnected(s: GithubStored): s is GithubStored & { tokenEnc: string; login: string; id: number } {
  return !!s.tokenEnc && !!s.login && typeof s.id === "number";
}

// Every GitHub token format (ghp_/gho_/ghu_/github_pat_/legacy hex) fits this.
// Enforced for every token we store, so nothing else can reach the credential
// helper's output or a CLI's environment (e.g. a newline adding git
// credential attributes).
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** Only https URLs from GitHub responses reach the browser (rendered as href/src). */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function tokenKindOf(token: string): GithubTokenKind {
  if (token.startsWith("ghp_")) return "classic";
  if (token.startsWith("github_pat_")) return "fine-grained";
  if (token.startsWith("gho_")) return "oauth";
  if (token.startsWith("ghu_")) return "app";
  return "unknown";
}

/** GitHub's private commit address; avoids GH007 push rejections for private emails. */
export function noreplyEmail(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}

function scopeWarnings(s: GithubStored): string[] {
  // Only classic/OAuth tokens report scopes (X-OAuth-Scopes); fine-grained and
  // GitHub App tokens carry permissions instead.
  if (s.tokenKind !== "classic" && s.tokenKind !== "oauth") return [];
  const scopes = s.scopes ?? [];
  const out: string[] = [];
  if (!scopes.includes("repo")) {
    out.push(scopes.includes("public_repo")
      ? "Nur Scope „public_repo“ — Push in private Repositories ist nicht möglich."
      : "Scope „repo“ fehlt — git push wird abgelehnt.");
  }
  if (!scopes.includes("workflow")) {
    out.push("Scope „workflow“ fehlt — Änderungen an .github/workflows werden beim Push abgelehnt.");
  }
  return out;
}

export async function getGithubStatus(): Promise<GithubStatus> {
  const s = await readStored();
  const connected = isConnected(s);
  const tokenReadable = connected && decryptSecret(s.tokenEnc) !== null;
  const warnings = connected ? scopeWarnings(s) : [];
  if (connected && !tokenReadable) {
    warnings.unshift("Gespeicherter Token kann nicht entschlüsselt werden (Schlüssel geändert?) — bitte neu verbinden.");
  }
  const refreshable = !!s.refreshTokenEnc && (!s.refreshExpiresAt || Date.parse(s.refreshExpiresAt) > Date.now());
  if (connected && s.tokenExpiresAt && !refreshable && Date.parse(s.tokenExpiresAt) < Date.now()) {
    warnings.unshift("Token ist abgelaufen — bitte neu verbinden.");
  }
  return {
    connected,
    tokenReadable,
    method: connected ? s.method ?? null : null,
    tokenKind: connected ? s.tokenKind ?? null : null,
    login: connected ? s.login : null,
    name: connected ? s.name ?? null : null,
    id: connected ? s.id : null,
    avatarUrl: connected ? s.avatarUrl ?? null : null,
    email: connected ? s.email ?? null : null,
    profileUrl: connected ? `https://github.com/${s.login}` : null,
    commitEmail: connected ? noreplyEmail(s.id, s.login) : null,
    scopes: connected ? s.scopes ?? [] : [],
    connectedAt: connected ? s.connectedAt ?? null : null,
    expiresAt: connected ? s.tokenExpiresAt ?? null : null,
    autoRefresh: connected && refreshable,
    warnings,
    injectIntoAssistant: s.injectIntoAssistant,
    gitIdentity: s.gitIdentity,
    oauthClientId: s.oauthClientId ?? "",
    envClientId: !!process.env.GITHUB_OAUTH_CLIENT_ID?.trim(),
  };
}

// --- HTTP ------------------------------------------------------------------

async function ghFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const reason = timeout ? "Zeitüberschreitung" : err instanceof Error ? err.message : String(err);
    throw new GithubError(`GitHub nicht erreichbar (${reason}).`, 502, "GITHUB_UNREACHABLE");
  }
}

function apiGet(pathAndQuery: string, token: string): Promise<Response> {
  return ghFetch(`${API}${pathAndQuery}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
  });
}

/** OAuth endpoints: form-encoded request, JSON response (needs the Accept header). */
async function oauthPost(url: string, form: Record<string, string>): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const res = await ghFetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams(form).toString(),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, data };
}

function apiFailure(res: Response, what: string): GithubError {
  if (res.status === 401) return new GithubError("Token ungültig, abgelaufen oder widerrufen.", 400, "GITHUB_BAD_TOKEN");
  if (res.status === 403 || res.status === 429) {
    const limited = res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429;
    return new GithubError(
      limited ? "GitHub-Rate-Limit erreicht — bitte später erneut versuchen." : `GitHub verweigert den Zugriff auf ${what} (SSO-Freigabe oder fehlende Berechtigung?).`,
      limited ? 429 : 400,
      limited ? "GITHUB_RATE_LIMIT" : "GITHUB_FORBIDDEN"
    );
  }
  return new GithubError(`GitHub-Fehler ${res.status} beim Abruf von ${what}.`, 502);
}

function parseScopes(header: string | null): string[] {
  return (header ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

interface GithubUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

async function fetchProfile(token: string): Promise<{ user: GithubUser; scopes: string[] }> {
  const res = await apiGet("/user", token);
  if (!res.ok) throw apiFailure(res, "/user");
  const user = (await res.json().catch(() => null)) as GithubUser | null;
  if (!user?.login || typeof user.id !== "number") {
    throw new GithubError("Unerwartete Antwort von GitHub (/user).", 502);
  }
  return { user, scopes: parseScopes(res.headers.get("x-oauth-scopes")) };
}

// --- Connect / disconnect --------------------------------------------------

interface ExpiryInfo {
  expiresIn?: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  clientId?: string;
}

function isoIn(seconds: number | undefined): string | undefined {
  return typeof seconds === "number" && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : undefined;
}

function seal(secret: string): string {
  try {
    return encryptSecret(secret);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new GithubError(`Token konnte nicht verschlüsselt gespeichert werden: ${reason}`, 500, "SECRET_STORE");
  }
}

async function storeConnection(token: string, method: GithubMethod, expiry: ExpiryInfo = {}): Promise<GithubStatus> {
  if (!isWellFormedToken(token) || (expiry.refreshToken !== undefined && !isWellFormedToken(expiry.refreshToken))) {
    throw new GithubError("GitHub hat einen Token in unerwartetem Format geliefert.", 502, "GITHUB_BAD_TOKEN_FORMAT");
  }
  const { user, scopes } = await fetchProfile(token);
  const current = await readStored();
  const refresh = expiry.refreshToken && expiry.clientId;
  await writeStored({
    ...withoutConnection(current),
    tokenEnc: seal(token),
    method,
    tokenKind: tokenKindOf(token),
    login: user.login,
    name: user.name,
    id: user.id,
    avatarUrl: httpsUrl(user.avatar_url) ?? undefined,
    email: user.email,
    scopes,
    connectedAt: new Date().toISOString(),
    tokenExpiresAt: isoIn(expiry.expiresIn),
    ...(refresh
      ? {
          refreshTokenEnc: seal(expiry.refreshToken!),
          refreshExpiresAt: isoIn(expiry.refreshExpiresIn),
          refreshClientId: expiry.clientId,
        }
      : {}),
  });
  return getGithubStatus();
}

/** Validates a personal access token against GET /user and stores it encrypted. */
export async function connectWithToken(token: string): Promise<GithubStatus> {
  const t = token.trim();
  if (!isWellFormedToken(t)) throw new GithubError("Ungültiges Token-Format.", 400, "VALIDATION_ERROR");
  return storeConnection(t, "token");
}

/** Forgets the token locally (it stays valid on GitHub until revoked there). Options are kept. */
export async function disconnect(): Promise<GithubStatus> {
  await writeStored(withoutConnection(await readStored()));
  return getGithubStatus();
}

export interface GithubOptionsPatch {
  injectIntoAssistant?: boolean;
  gitIdentity?: boolean;
  oauthClientId?: string;
}

export async function updateGithubOptions(patch: GithubOptionsPatch): Promise<GithubStatus> {
  const next = await readStored();
  if (patch.injectIntoAssistant !== undefined) next.injectIntoAssistant = patch.injectIntoAssistant;
  if (patch.gitIdentity !== undefined) next.gitIdentity = patch.gitIdentity;
  if (patch.oauthClientId !== undefined) {
    const id = patch.oauthClientId.trim();
    if (id) next.oauthClientId = id;
    else delete next.oauthClientId;
  }
  await writeStored(next);
  return getGithubStatus();
}

// --- Device flow -----------------------------------------------------------
// The device_code is the credential that turns into a token, so it stays on the
// server; the browser only gets an opaque flowId. GitHub's endpoints don't
// support CORS, so the flow can't run in the browser anyway.

interface DeviceFlow {
  clientId: string;
  deviceCode: string;
  interval: number; // seconds
  expiresAt: number; // ms epoch
  nextPollAt: number; // ms epoch; never poll GitHub earlier (avoids slow_down)
  polling: boolean;
}

const MAX_FLOWS = 20;
const g = globalThis as unknown as { __cmGithubFlows?: Map<string, DeviceFlow> };
const flows: Map<string, DeviceFlow> = (g.__cmGithubFlows ??= new Map());

function purgeExpiredFlows() {
  const now = Date.now();
  for (const [id, f] of flows) if (f.expiresAt <= now) flows.delete(id);
}

function oauthErrorMessage(error: unknown, description: unknown, status: number): string {
  switch (error) {
    case "device_flow_disabled":
      return "Device Flow ist für diese OAuth-App nicht aktiviert — in den App-Einstellungen „Enable Device Flow“ ankreuzen.";
    case "incorrect_client_credentials":
      return "Client-ID unbekannt — bitte die Client-ID der OAuth-App prüfen.";
    case "unsupported_grant_type":
    case "incorrect_device_code":
    case "bad_verification_code":
      return "Ungültiger Gerätecode — bitte Anmeldung neu starten.";
    default:
      if (status === 404) return "Client-ID unbekannt — bitte die Client-ID der OAuth-App prüfen.";
      return `GitHub-Fehler: ${typeof description === "string" && description ? description : typeof error === "string" ? error : `HTTP ${status}`}`;
  }
}

export interface DeviceFlowStart {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function startDeviceFlow(clientId?: string): Promise<DeviceFlowStart> {
  const stored = await readStored();
  const explicit = clientId?.trim();
  const id = explicit || stored.oauthClientId || process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || "";
  if (!id) {
    throw new GithubError("Keine OAuth-App-Client-ID — bitte eine Client-ID eintragen (siehe Anleitung).", 400, "NO_CLIENT_ID");
  }
  const { status, data } = await oauthPost(DEVICE_CODE_URL, { client_id: id, scope: DEVICE_SCOPES });
  if (!data || data.error || typeof data.device_code !== "string" || typeof data.user_code !== "string") {
    throw new GithubError(oauthErrorMessage(data?.error, data?.error_description, status), 400, "DEVICE_FLOW");
  }
  const interval = typeof data.interval === "number" && data.interval > 0 ? data.interval : 5;
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 900;
  purgeExpiredFlows();
  // Map iteration is insertion order: drop the oldest beyond the cap.
  while (flows.size >= MAX_FLOWS) flows.delete(flows.keys().next().value!);
  const flowId = randomUUID();
  const now = Date.now();
  flows.set(flowId, {
    clientId: id,
    deviceCode: data.device_code,
    interval,
    expiresAt: now + expiresIn * 1000,
    nextPollAt: now + interval * 1000,
    polling: false,
  });
  // Remember a working client id so the user doesn't have to enter it again.
  if (explicit && explicit !== stored.oauthClientId) {
    await writeStored({ ...(await readStored()), oauthClientId: explicit });
  }
  return {
    flowId,
    userCode: data.user_code,
    verificationUri: httpsUrl(data.verification_uri) ?? "https://github.com/login/device",
    expiresIn,
    interval,
  };
}

export type DevicePollStatus = "pending" | "slow_down" | "expired" | "denied" | "error" | "connected";

export interface DevicePollResult {
  status: DevicePollStatus;
  message?: string;
  interval?: number;
}

export async function pollDeviceFlow(flowId: string): Promise<DevicePollResult> {
  purgeExpiredFlows();
  const flow = flows.get(flowId);
  if (!flow) return { status: "expired", message: "Anmeldung abgelaufen oder unbekannt — bitte neu starten." };
  // Honor GitHub's interval no matter how often the browser asks; a poll that
  // is still storing the token also reads as pending.
  if (flow.polling || Date.now() < flow.nextPollAt) return { status: "pending", interval: flow.interval };
  flow.polling = true;
  try {
    return await pollOnce(flowId, flow);
  } finally {
    flow.polling = false;
  }
}

async function pollOnce(flowId: string, flow: DeviceFlow): Promise<DevicePollResult> {
  let data: Record<string, unknown> | null;
  let status: number;
  try {
    ({ status, data } = await oauthPost(ACCESS_TOKEN_URL, { client_id: flow.clientId, device_code: flow.deviceCode, grant_type: DEVICE_GRANT }));
  } catch (err) {
    // Transient network problem: keep the flow and retry on the next poll.
    flow.nextPollAt = Date.now() + flow.interval * 1000;
    return { status: "pending", interval: flow.interval, message: githubErrorInfo(err).error };
  }
  if (!data || status >= 500) {
    // GitHub hiccup (5xx / HTML error page): same as a network problem.
    flow.nextPollAt = Date.now() + flow.interval * 1000;
    return { status: "pending", interval: flow.interval, message: `GitHub antwortet nicht wie erwartet (HTTP ${status}) — neuer Versuch …` };
  }

  if (typeof data.access_token === "string" && data.access_token) {
    try {
      await storeConnection(data.access_token, "device", {
        expiresIn: typeof data.expires_in === "number" ? data.expires_in : undefined,
        refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
        refreshExpiresIn: typeof data.refresh_token_expires_in === "number" ? data.refresh_token_expires_in : undefined,
        clientId: flow.clientId,
      });
    } catch (err) {
      return { status: "error", message: githubErrorInfo(err).error };
    } finally {
      flows.delete(flowId); // the device code is consumed either way
    }
    return { status: "connected" };
  }

  switch (data.error) {
    case "authorization_pending":
      flow.nextPollAt = Date.now() + flow.interval * 1000;
      return { status: "pending", interval: flow.interval };
    case "slow_down": {
      const suggested = typeof data.interval === "number" ? data.interval : 0;
      flow.interval = Math.max(suggested, flow.interval + 5);
      flow.nextPollAt = Date.now() + flow.interval * 1000;
      return { status: "slow_down", interval: flow.interval };
    }
    case "expired_token":
    case "token_expired":
      flows.delete(flowId);
      return { status: "expired", message: "Code abgelaufen — bitte neu starten." };
    case "access_denied":
      flows.delete(flowId);
      return { status: "denied", message: "Anmeldung auf GitHub abgebrochen." };
    default:
      flows.delete(flowId);
      return { status: "error", message: oauthErrorMessage(data.error, data.error_description, status) };
  }
}

export function cancelDeviceFlow(flowId: string): void {
  flows.delete(flowId);
}

// --- Token access ------------------------------------------------------------

const REFRESH_MARGIN_MS = 5 * 60_000;
const gr = globalThis as unknown as { __cmGithubRefresh?: Promise<string | null> | null };

/** Exchanges the refresh token (expiring GitHub App / opt-in tokens). Single-flight. */
function refreshToken(stored: GithubStored): Promise<string | null> {
  if (!gr.__cmGithubRefresh) {
    const p: Promise<string | null> = doRefresh(stored).finally(() => {
      if (gr.__cmGithubRefresh === p) gr.__cmGithubRefresh = null;
    });
    gr.__cmGithubRefresh = p;
  }
  return gr.__cmGithubRefresh;
}

async function doRefresh(stored: GithubStored): Promise<string | null> {
  try {
    const refresh = decryptSecret(stored.refreshTokenEnc);
    if (!refresh || !stored.refreshClientId) return null;
    const { data } = await oauthPost(ACCESS_TOKEN_URL, {
      client_id: stored.refreshClientId,
      grant_type: "refresh_token",
      refresh_token: refresh,
    });
    if (!data || typeof data.access_token !== "string" || !isWellFormedToken(data.access_token)) return null;
    // Don't resurrect a connection that was replaced or removed meanwhile.
    const latest = await readStored();
    if (latest.tokenEnc !== stored.tokenEnc) return decryptSecret(latest.tokenEnc);
    await writeStored({
      ...latest,
      tokenEnc: seal(data.access_token),
      tokenExpiresAt: isoIn(typeof data.expires_in === "number" ? data.expires_in : undefined),
      ...(typeof data.refresh_token === "string" && isWellFormedToken(data.refresh_token)
        ? {
            refreshTokenEnc: seal(data.refresh_token),
            refreshExpiresAt: isoIn(typeof data.refresh_token_expires_in === "number" ? data.refresh_token_expires_in : undefined),
          }
        : {}),
    });
    return data.access_token;
  } catch {
    return null;
  }
}

async function usableToken(stored: GithubStored): Promise<string | null> {
  const token = decryptSecret(stored.tokenEnc);
  if (!token || !stored.tokenExpiresAt) return token;
  const expiresAt = Date.parse(stored.tokenExpiresAt);
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) return token;
  const refreshed = stored.refreshTokenEnc ? await refreshToken(stored) : null;
  return refreshed ?? (expiresAt > Date.now() ? token : null);
}

async function requireToken(): Promise<{ stored: GithubStored; token: string }> {
  const stored = await readStored();
  if (!isConnected(stored)) throw new GithubError("Kein GitHub-Konto verbunden.", 400, "NOT_CONNECTED");
  const token = await usableToken(stored);
  if (!token) {
    throw new GithubError("Gespeicherter Token ist nicht nutzbar (abgelaufen oder nicht entschlüsselbar) — bitte neu verbinden.", 400, "TOKEN_UNUSABLE");
  }
  return { stored, token };
}

export interface GithubRepoCheck {
  fullName: string;
  private: boolean;
  push: boolean;
  url: string;
  pushedAt: string | null;
}

/** Proves the token works: lists up to 5 recently pushed repos with the account's push right. */
export async function testGithubConnection(): Promise<{ login: string; scopes: string[]; repos: GithubRepoCheck[] }> {
  const { stored, token } = await requireToken();
  const res = await apiGet("/user/repos?sort=pushed&direction=desc&per_page=5", token);
  if (!res.ok) throw apiFailure(res, "/user/repos");
  const list = (await res.json().catch(() => null)) as Array<{
    full_name: string;
    private: boolean;
    html_url: string;
    pushed_at: string | null;
    permissions?: { push?: boolean };
  }> | null;
  const scopes = res.headers.has("x-oauth-scopes") ? parseScopes(res.headers.get("x-oauth-scopes")) : stored.scopes ?? [];
  // Keep the displayed scopes current (they can be edited on GitHub at any time).
  if (JSON.stringify(scopes) !== JSON.stringify(stored.scopes ?? [])) {
    const latest = await readStored();
    if (latest.tokenEnc === stored.tokenEnc) await writeStored({ ...latest, scopes });
  }
  return {
    login: stored.login!,
    scopes,
    repos: (Array.isArray(list) ? list : []).map((r) => ({
      fullName: String(r.full_name ?? ""),
      private: !!r.private,
      push: !!r.permissions?.push,
      url: httpsUrl(r.html_url) ?? `https://github.com/${r.full_name}`,
      pushedAt: r.pushed_at ?? null,
    })),
  };
}

// --- CLI environment -----------------------------------------------------------

// Inline git credential helper. It reads the token from the environment at run
// time, so the token never appears in a config value (GIT_CONFIG_VALUE_*) or on
// a command line. Falls back to GH_TOKEN, which Claude Code's env scrub
// (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB) keeps while it strips custom *_TOKEN vars.
// The expansion is double-quoted and printed with printf %s (no word
// splitting, globbing or backslash escapes); "store"/"erase" are no-ops so a
// rejected push never touches other helpers' saved credentials.
const CREDENTIAL_HELPER =
  `!f() { test "$1" = get || exit 0; printf 'username=x-access-token\\npassword=%s\\n' "\${CODEMAESTRO_GH_TOKEN:-$GH_TOKEN}"; }; f`;

/**
 * Env vars for an assistant CLI run so git/gh can authenticate against GitHub.
 * Empty when no account is connected, injection is off, or the token is unusable.
 * Never throws (a failure here must not block a turn).
 */
export async function githubEnv(): Promise<Record<string, string>> {
  try {
    const stored = await readStored();
    if (!isConnected(stored) || !stored.injectIntoAssistant) return {};
    const token = await usableToken(stored);
    if (!token || !isWellFormedToken(token)) return {};

    const env: Record<string, string> = {
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
      CODEMAESTRO_GH_TOKEN: token,
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
    };

    // Append to any GIT_CONFIG_* the server already passes on, don't clobber it.
    const base = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? "", 10);
    let n = Number.isInteger(base) && base > 0 ? base : 0;
    const add = (key: string, value: string) => {
      env[`GIT_CONFIG_KEY_${n}`] = key;
      env[`GIT_CONFIG_VALUE_${n}`] = value;
      n++;
    };
    // Empty value resets helpers configured earlier for github.com (e.g. a stale
    // osxkeychain/store entry); other hosts keep their helpers.
    add("credential.https://github.com.helper", "");
    add("credential.https://github.com.helper", CREDENTIAL_HELPER);
    // SSH remotes can't use the token (and ssh ignores the sandbox proxy): go via HTTPS.
    add("url.https://github.com/.insteadOf", "git@github.com:");
    add("url.https://github.com/.insteadOf", "ssh://git@github.com/");
    env.GIT_CONFIG_COUNT = String(n);

    if (stored.gitIdentity) {
      // Profile names are free text: control chars (a NUL makes spawn throw)
      // and the <> git uses around the email are dropped.
      const name = (stored.name ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim() || stored.login;
      const email = noreplyEmail(stored.id, stored.login);
      env.GIT_AUTHOR_NAME = name;
      env.GIT_AUTHOR_EMAIL = email;
      env.GIT_COMMITTER_NAME = name;
      env.GIT_COMMITTER_EMAIL = email;
    }
    return env;
  } catch {
    return {};
  }
}
