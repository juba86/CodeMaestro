import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    assistantSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: "s1", ...data };
      },
    },
  },
}));
vi.mock("@/lib/assistant/security", () => ({ resolveWorkdir: async (p?: string) => p || "/work" }));

import { POST } from "@/app/api/assistant/sessions/route";
import { supportsApprovalGate, supportsSandbox } from "@/lib/assistant/runner";
import { AGENTS, APPROVAL_CAPABLE, SANDBOX_CAPABLE } from "@/components/assistant/new-session";

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://127.0.0.1:3000/api/assistant/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.created.length = 0;
});

describe("POST /api/assistant/sessions", () => {
  it("rejects an approval gate the agent cannot enforce instead of storing it as off", async () => {
    const res = await post({ provider: "gemini", cwd: "/w", approvalMode: "all" });
    expect(res.status).toBe(400);
    const d = (await res.json()) as { error: string; code: string };
    expect(d.code).toBe("VALIDATION_ERROR");
    expect(d.error).toContain("Gemini CLI unterstützt kein Freigabe-Gate");
    expect(state.created).toEqual([]);
  });

  it("rejects a sandbox the agent cannot run in", async () => {
    const res = await post({ provider: "pi", cwd: "/w", approvalMode: "all", sandbox: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("keine Sandbox");
    expect(state.created).toEqual([]);
  });

  it("stores supported settings unchanged", async () => {
    expect((await post({ provider: "claude", cwd: "/w", approvalMode: "all", sandbox: true })).status).toBe(201);
    expect((await post({ provider: "pi", cwd: "/w", approvalMode: "edits" })).status).toBe(201);
    expect((await post({ provider: "codex", cwd: "/w" })).status).toBe(201);
    expect(state.created.map((d) => [d.provider, d.approvalMode, d.sandbox])).toEqual([
      ["claude", "all", true],
      ["pi", "edits", false],
      ["codex", "off", false],
    ]);
  });

  it("matches the capabilities the New-Session sheet assumes", () => {
    // The sheet only offers a gate/sandbox where these sets allow it; if they
    // drift from the runner, users would hit the 400 above.
    for (const a of AGENTS) {
      expect(APPROVAL_CAPABLE.has(a), a).toBe(supportsApprovalGate(a));
      expect(SANDBOX_CAPABLE.has(a), a).toBe(supportsSandbox(a));
    }
  });
});
