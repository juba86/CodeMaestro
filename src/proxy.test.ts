import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function call(url: string, headers: Record<string, string>, method = "GET") {
  return proxy(new NextRequest(url, { method, headers }));
}

async function code(res: Response): Promise<string | null> {
  if (res.status === 200) return null;
  return ((await res.json()) as { code: string }).code;
}

const ENV_KEYS = ["CODEMAESTRO_ALLOWED_HOSTS", "CODEMAESTRO_ALLOWED_ORIGINS", "CODEMAESTRO_TAILSCALE_USERS"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("proxy host allowlist", () => {
  it("blocks a DNS-rebinding page that passes the same-origin CSRF check", async () => {
    // Origin, Sec-Fetch-Site and Host all name the attacker's domain.
    const post = call(
      "http://evil.example:3000/api/assistant/sessions",
      { host: "evil.example:3000", origin: "http://evil.example:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      "POST"
    );
    expect(post.status).toBe(403);
    expect(await code(post)).toBe("FORBIDDEN_HOST");
    // Reads leak data too.
    expect(await code(call("http://evil.example:3000/api/assistant/sessions", { host: "evil.example:3000", "x-forwarded-host": "localhost" }))).toBe(
      "FORBIDDEN_HOST"
    );
  });

  it("lets the approval hook (127.0.0.1, no Origin) through", async () => {
    const res = call("http://127.0.0.1:3000/api/assistant/approval", { host: "127.0.0.1:3000" }, "POST");
    expect(await code(res)).toBeNull();
  });

  it("lets the browser behind tailscale serve through", async () => {
    const origin = "https://devbox.tail1234.ts.net";
    const res = call(
      "http://127.0.0.1:3000/api/assistant/sessions",
      { host: "devbox.tail1234.ts.net", "x-forwarded-host": "devbox.tail1234.ts.net", origin, "sec-fetch-site": "same-origin" },
      "POST"
    );
    expect(await code(res)).toBeNull();
  });

  it("accepts names from CODEMAESTRO_ALLOWED_HOSTS", async () => {
    process.env.CODEMAESTRO_ALLOWED_HOSTS = "*.example.com";
    expect(await code(call("https://cm.example.com/api/x", { host: "cm.example.com" }))).toBeNull();
    expect(await code(call("https://cm.example.org/api/x", { host: "cm.example.org" }))).toBe("FORBIDDEN_HOST");
  });

  it("keeps the CSRF check for allowed hosts", async () => {
    const res = call("http://localhost:3000/api/x", { host: "localhost:3000", origin: "http://evil.example", "sec-fetch-site": "cross-site" }, "POST");
    expect(await code(res)).toBe("FORBIDDEN_ORIGIN");
  });
});
