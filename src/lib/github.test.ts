import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory Setting table ---------------------------------------------------
const db = vi.hoisted(() => ({ settings: new Map<string, string>() }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key)! } : null
      ),
      upsert: vi.fn(
        async ({ where, update, create }: { where: { key: string }; update: { value: string }; create: { value: string } }) => {
          db.settings.set(where.key, db.settings.has(where.key) ? update.value : create.value);
          return { key: where.key, value: db.settings.get(where.key) };
        }
      ),
    },
  },
}));

import { decryptSecret, encryptSecret, resetSecretKeyCache, secretKeyFile } from "./secret-box";
import {
  GithubError,
  connectWithToken,
  disconnect,
  getGithubStatus,
  githubEnv,
  githubErrorInfo,
  pollDeviceFlow,
  startDeviceFlow,
  testGithubConnection,
  updateGithubOptions,
} from "./github";

const TOKEN = "ghp_TESTtoken0123456789abcdefABCDEF0123";
const PROFILE = { login: "octo", id: 4242, name: "Octo Cat", avatar_url: "https://avatars.example/u/4242", email: "octo@example.com" };

type FetchArgs = [string, RequestInit | undefined];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** fetch stub routing by URL; records calls. */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: FetchArgs[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return routes[key]();
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const profileRoute = () => jsonResponse(PROFILE, { headers: { "x-oauth-scopes": "repo, workflow, read:org" } });

beforeEach(() => {
  db.settings.clear();
  vi.stubEnv("CODEMAESTRO_SECRET", "unit-test-secret");
  vi.stubEnv("GIT_CONFIG_COUNT", "");
  resetSecretKeyCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetSecretKeyCache();
});

describe("secret-box", () => {
  it("round-trips and uses a fresh IV per value", () => {
    const a = encryptSecret("hällo wörld");
    const b = encryptSecret("hällo wörld");
    expect(a).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("hällo wörld");
    expect(decryptSecret(b)).toBe("hällo wörld");
  });

  it("returns null for tampered, malformed or foreign-key boxes", () => {
    const box = encryptSecret("secret");
    const [v, iv, tag, ct] = box.split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(decryptSecret([v, iv, tag, flip(ct)].join(":"))).toBeNull();
    expect(decryptSecret([v, iv, flip(tag), ct].join(":"))).toBeNull();
    expect(decryptSecret([v, flip(iv), tag, ct].join(":"))).toBeNull();
    expect(decryptSecret(["v2", iv, tag, ct].join(":"))).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    expect(decryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();

    vi.stubEnv("CODEMAESTRO_SECRET", "another-secret");
    expect(decryptSecret(box)).toBeNull();
  });

  it("creates a private key file when no env secret is set and reuses it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cm-secret-"));
    try {
      vi.stubEnv("CODEMAESTRO_SECRET", "");
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      resetSecretKeyCache();
      const box = encryptSecret("persisted");
      const file = secretKeyFile();
      expect(file).toBe(path.join(dir, ".codemaestro", "secret.key"));
      if (process.platform !== "win32") {
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      }
      resetSecretKeyCache(); // force re-reading the key from disk
      expect(decryptSecret(box)).toBe("persisted");

      // A lost key file: decrypting fails and does not mint a new key.
      rmSync(path.dirname(file), { recursive: true, force: true });
      resetSecretKeyCache();
      expect(decryptSecret(box)).toBeNull();
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

async function connect() {
  stubFetch({ "https://api.github.com/user": profileRoute });
  return connectWithToken(TOKEN);
}

describe("github connection", () => {
  it("stores the token encrypted and never exposes it in the status", async () => {
    const status = await connect();
    expect(status).toMatchObject({ connected: true, tokenReadable: true, login: "octo", method: "token", tokenKind: "classic" });
    expect(status.scopes).toEqual(["repo", "workflow", "read:org"]);
    expect(status.warnings).toEqual([]);
    expect(status.commitEmail).toBe("4242+octo@users.noreply.github.com");
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(db.settings.get("github")).not.toContain(TOKEN);
  });

  it("validates with Bearer auth, API version and User-Agent", async () => {
    const calls = stubFetch({ "https://api.github.com/user": profileRoute });
    await connectWithToken(TOKEN);
    const headers = calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["X-GitHub-Api-Version"]).toBeTruthy();
    expect(headers["User-Agent"]).toBe("CodeMaestro");
  });

  it("rejects a token GitHub refuses and stores nothing", async () => {
    stubFetch({ "https://api.github.com/user": () => jsonResponse({ message: "Bad credentials" }, { status: 401 }) });
    await expect(connectWithToken(TOKEN)).rejects.toBeInstanceOf(GithubError);
    expect((await getGithubStatus()).connected).toBe(false);
  });

  it("warns when a classic token lacks push scopes", async () => {
    stubFetch({ "https://api.github.com/user": () => jsonResponse(PROFILE, { headers: { "x-oauth-scopes": "read:org" } }) });
    const status = await connectWithToken(TOKEN);
    expect(status.warnings.join(" ")).toMatch(/repo/);
    expect(status.warnings.join(" ")).toMatch(/workflow/);
  });

  it("rejects malformed tokens before calling GitHub", async () => {
    const calls = stubFetch({ "https://api.github.com/user": profileRoute });
    for (const bad of [`${TOKEN}\nhost=evil.example`, `${TOKEN}$(id)`, "ghp_short", `${TOKEN}\\n`]) {
      await expect(connectWithToken(bad)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(calls).toHaveLength(0);
    expect((await getGithubStatus()).connected).toBe(false);
  });

  it("only passes https URLs from GitHub on to the browser", async () => {
    stubFetch({
      "https://api.github.com/user/repos": () =>
        jsonResponse([{ full_name: "octo/r", private: false, html_url: "javascript:alert(1)", pushed_at: null, permissions: { push: true } }], {
          headers: { "x-oauth-scopes": "repo, workflow, read:org" },
        }),
      "https://api.github.com/user": () =>
        jsonResponse({ ...PROFILE, avatar_url: "javascript:alert(1)" }, { headers: { "x-oauth-scopes": "repo, workflow" } }),
    });
    const status = await connectWithToken(TOKEN);
    expect(status.avatarUrl).toBeNull();
    const test = await testGithubConnection();
    expect(test.repos[0].url).toBe("https://github.com/octo/r");
  });

  it("hides unexpected error details from the browser", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = githubErrorInfo(new Error(`Invalid prisma.setting.upsert() invocation: { value: "${TOKEN}" }`));
    expect(info).toMatchObject({ status: 500, code: "INTERNAL" });
    expect(info.error).not.toContain(TOKEN);
    expect(spy).toHaveBeenCalled();
  });

  it("flags an expired token that can't be refreshed", async () => {
    await connect();
    const stored = JSON.parse(db.settings.get("github")!);
    db.settings.set("github", JSON.stringify({ ...stored, tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() }));
    const status = await getGithubStatus();
    expect(status.autoRefresh).toBe(false);
    expect(status.warnings[0]).toMatch(/abgelaufen/);
    expect(await githubEnv()).toEqual({});
  });

  it("disconnect forgets the account but keeps the options", async () => {
    await connect();
    await updateGithubOptions({ gitIdentity: false, oauthClientId: "Ov23liABCDEFGH123456" });
    const status = await disconnect();
    expect(status).toMatchObject({ connected: false, gitIdentity: false, oauthClientId: "Ov23liABCDEFGH123456", login: null });
    expect(await githubEnv()).toEqual({});
  });
});

describe("githubEnv", () => {
  it("is empty when nothing is connected", async () => {
    expect(await githubEnv()).toEqual({});
  });

  it("provides the token via env only and rewrites SSH remotes", async () => {
    await connect();
    const env = await githubEnv();
    expect(env.GH_TOKEN).toBe(TOKEN);
    expect(env.GITHUB_TOKEN).toBe(TOKEN);
    expect(env.CODEMAESTRO_GH_TOKEN).toBe(TOKEN);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");

    const count = Number(env.GIT_CONFIG_COUNT);
    expect(count).toBe(4);
    const pairs = Array.from({ length: count }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
    for (const [, value] of pairs) expect(value).not.toContain(TOKEN);
    expect(pairs[0]).toEqual(["credential.https://github.com.helper", ""]);
    expect(pairs[1][0]).toBe("credential.https://github.com.helper");
    expect(pairs[1][1]).toContain("${CODEMAESTRO_GH_TOKEN:-$GH_TOKEN}");
    expect(pairs).toContainEqual(["url.https://github.com/.insteadOf", "git@github.com:"]);
    expect(pairs).toContainEqual(["url.https://github.com/.insteadOf", "ssh://git@github.com/"]);

    expect(env.GIT_AUTHOR_NAME).toBe("Octo Cat");
    expect(env.GIT_AUTHOR_EMAIL).toBe("4242+octo@users.noreply.github.com");
    expect(env.GIT_COMMITTER_NAME).toBe("Octo Cat");
    expect(env.GIT_COMMITTER_EMAIL).toBe("4242+octo@users.noreply.github.com");
  });

  it("appends to GIT_CONFIG_* the server already passes on", async () => {
    await connect();
    vi.stubEnv("GIT_CONFIG_COUNT", "2");
    const env = await githubEnv();
    expect(env.GIT_CONFIG_COUNT).toBe("6");
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_1).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_2).toBe("credential.https://github.com.helper");
    expect(env.GIT_CONFIG_KEY_5).toBe("url.https://github.com/.insteadOf");
  });

  it("sets identity vars only with gitIdentity, nothing without injectIntoAssistant", async () => {
    await connect();
    await updateGithubOptions({ gitIdentity: false });
    const env = await githubEnv();
    expect(env.GH_TOKEN).toBe(TOKEN);
    for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
      expect(env[k]).toBeUndefined();
    }
    await updateGithubOptions({ injectIntoAssistant: false });
    expect(await githubEnv()).toEqual({});
  });

  it("drops control characters from the author name", async () => {
    stubFetch({ "https://api.github.com/user": () => jsonResponse({ ...PROFILE, name: "Evil\u0000\nName <x>" }, { headers: { "x-oauth-scopes": "repo" } }) });
    await connectWithToken(TOKEN);
    const env = await githubEnv();
    expect(env.GIT_AUTHOR_NAME).toBe("EvilName x");
    for (const v of Object.values(env)) expect(v).not.toMatch(/[\u0000\n]/);
  });

  it("is empty when the stored token can't be decrypted", async () => {
    await connect();
    vi.stubEnv("CODEMAESTRO_SECRET", "rotated-secret");
    expect(await githubEnv()).toEqual({});
    const status = await getGithubStatus();
    expect(status.tokenReadable).toBe(false);
    expect(status.warnings[0]).toMatch(/entschlüsselt/);
  });

  const hasGit = spawnSync("git", ["--version"]).status === 0;
  it.skipIf(!hasGit)("makes `git credential fill` answer with the token for github.com only", async () => {
    await connect();
    const env = await githubEnv();
    const home = mkdtempSync(path.join(tmpdir(), "cm-git-home-"));
    try {
      const run = (input: string) =>
        spawnSync("git", ["credential", "fill"], {
          input,
          encoding: "utf8",
          env: { ...process.env, ...env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1" },
        });
      const gh = run("protocol=https\nhost=github.com\npath=o/r.git\n\n");
      expect(gh.stdout).toContain("username=x-access-token");
      expect(gh.stdout).toContain(`password=${TOKEN}`);
      // Other hosts don't get the token (no helper → git fails without prompting).
      const other = run("protocol=https\nhost=gitlab.com\n\n");
      expect(other.stdout).not.toContain(TOKEN);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("device flow", () => {
  it("keeps the device code server-side, honors interval and slow_down, then connects", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    const tokenResponses: Array<() => Response> = [
      () => jsonResponse({ error: "authorization_pending" }),
      () => jsonResponse({ error: "slow_down", interval: 10 }),
      () => jsonResponse({ access_token: "gho_DEVICEtoken0123456789abcdefABCDEF01", token_type: "bearer", scope: "repo,workflow,read:org" }),
    ];
    const calls = stubFetch({
      "https://github.com/login/device/code": () =>
        jsonResponse({ device_code: "d".repeat(40), user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }),
      "https://github.com/login/oauth/access_token": () => tokenResponses.shift()!(),
      "https://api.github.com/user": profileRoute,
    });

    const start = await startDeviceFlow("Ov23liABCDEFGH123456");
    expect(start).toMatchObject({ userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", interval: 5, expiresIn: 900 });
    expect(JSON.stringify(start)).not.toContain("d".repeat(40));
    expect(calls[0][1]?.body).toContain("scope=repo+workflow+read%3Aorg");
    expect((calls[0][1]?.headers as Record<string, string>).Accept).toBe("application/json");
    // The client id that worked is remembered.
    expect((await getGithubStatus()).oauthClientId).toBe("Ov23liABCDEFGH123456");

    const tokenCalls = () => calls.filter(([u]) => u.startsWith("https://github.com/login/oauth/access_token")).length;

    // Too early: answered locally, GitHub isn't asked.
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "pending" });
    expect(tokenCalls()).toBe(0);

    vi.setSystemTime(Date.now() + 5_000);
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "pending", interval: 5 });
    expect(tokenCalls()).toBe(1);

    vi.setSystemTime(Date.now() + 5_000);
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "slow_down", interval: 10 });
    expect(tokenCalls()).toBe(2);

    vi.setSystemTime(Date.now() + 5_000); // still inside the raised interval
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "pending" });
    expect(tokenCalls()).toBe(2);

    vi.setSystemTime(Date.now() + 5_000);
    expect(await pollDeviceFlow(start.flowId)).toEqual({ status: "connected" });
    expect(tokenCalls()).toBe(3);
    const body = String(calls.find(([u]) => u.startsWith("https://github.com/login/oauth/access_token"))![1]?.body);
    expect(body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");

    const status = await getGithubStatus();
    expect(status).toMatchObject({ connected: true, method: "device", tokenKind: "oauth", login: "octo" });
    // The flow is consumed.
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "expired" });
  });

  it("maps denial and disabled device flow to clear results", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubFetch({
      "https://github.com/login/device/code": () =>
        jsonResponse({ device_code: "e".repeat(40), user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }),
      "https://github.com/login/oauth/access_token": () => jsonResponse({ error: "access_denied" }),
    });
    const start = await startDeviceFlow("Ov23liABCDEFGH123456");
    vi.setSystemTime(Date.now() + 6_000);
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "denied" });

    stubFetch({ "https://github.com/login/device/code": () => jsonResponse({ error: "device_flow_disabled" }) });
    await expect(startDeviceFlow("Ov23liABCDEFGH123456")).rejects.toThrow(/Device Flow/);
  });

  it("treats GitHub 5xx as transient and refuses malformed tokens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const tokenResponses: Array<() => Response> = [
      () => new Response("<html>502</html>", { status: 502 }),
      () => jsonResponse({ access_token: "gho_bad\ntoken0123456789abcdef", token_type: "bearer" }),
    ];
    stubFetch({
      "https://github.com/login/device/code": () =>
        jsonResponse({ device_code: "f".repeat(40), user_code: "ABCD-EFGH", verification_uri: "javascript:alert(1)", expires_in: 900, interval: 5 }),
      "https://github.com/login/oauth/access_token": () => tokenResponses.shift()!(),
      "https://api.github.com/user": profileRoute,
    });
    const start = await startDeviceFlow("Ov23liABCDEFGH123456");
    expect(start.verificationUri).toBe("https://github.com/login/device");

    vi.setSystemTime(Date.now() + 6_000);
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "pending", interval: 5 });

    vi.setSystemTime(Date.now() + 6_000);
    expect(await pollDeviceFlow(start.flowId)).toMatchObject({ status: "error" });
    expect((await getGithubStatus()).connected).toBe(false);
  });

  it("requires a client id when none is stored or configured", async () => {
    vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "");
    await expect(startDeviceFlow()).rejects.toMatchObject({ code: "NO_CLIENT_ID" });
  });
});
