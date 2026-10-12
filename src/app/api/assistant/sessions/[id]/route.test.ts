import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, update, noteAgentSwitch } = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), noteAgentSwitch: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { assistantSession: { findUnique, update } } }));
vi.mock("@/lib/assistant/session-run", () => ({ stopRunNow: vi.fn(), noteAgentSwitch }));
vi.mock("@/lib/assistant/devserver", () => ({ stopDev: vi.fn() }));
vi.mock("@/lib/push", () => ({ notifySession: vi.fn(async () => {}) }));

import { PATCH } from "./route";
import { beginRun, endRun } from "@/lib/assistant/run-hub";

const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/assistant/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

afterEach(() => {
  findUnique.mockReset();
  update.mockReset();
  noteAgentSwitch.mockReset();
});

describe("PATCH /api/assistant/sessions/[id]", () => {
  it("switches the model of an idle session", async () => {
    findUnique.mockResolvedValue({ provider: "pi" });
    update.mockResolvedValue({ id: "s1", model: "flash-next-262k" });
    const res = await patch("s1", { model: " flash-next-262k " });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { model: "flash-next-262k" } });
  });

  it("moves a session to another agent: new conversation, no sandbox on pi, a note for the handover", async () => {
    findUnique.mockResolvedValue({ provider: "pi", model: "flash-next-262k" });
    update.mockResolvedValue({ id: "s1", provider: "claude", model: "opus" });
    expect((await patch("s1", { model: "opus", provider: "claude" })).status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { model: "opus", provider: "claude", externalId: null } });
    expect(noteAgentSwitch).toHaveBeenCalledWith("s1", "pi · flash-next-262k", "Claude Code · opus");

    findUnique.mockResolvedValue({ provider: "claude", model: "" });
    expect((await patch("s2", { model: "kolibri", provider: "pi" })).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith({ where: { id: "s2" }, data: { model: "kolibri", provider: "pi", externalId: null, sandbox: false } });
    // Claude Code's default model is "", and a same-agent change keeps the conversation.
    expect((await patch("s2", { model: "" })).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith({ where: { id: "s2" }, data: { model: "" } });
    expect(noteAgentSwitch).toHaveBeenCalledTimes(2);
    expect((await patch("s2", { model: "", provider: "pi" })).status).toBe(400);
  });

  it("refuses while the session runs, an invalid pi model id and an unknown session", async () => {
    findUnique.mockResolvedValue({ provider: "pi" });
    const run = beginRun("patch-busy", "turn", "pwa");
    expect((await patch("patch-busy", { model: "kolibri" })).status).toBe(409);
    endRun("patch-busy", run.info.runId, "idle");
    update.mockReset();
    expect((await patch("s1", { model: "bad model; rm" })).status).toBe(400);
    expect((await patch("s1", { model: "" })).status).toBe(400);
    findUnique.mockResolvedValue(null);
    expect((await patch("gone", { model: "kolibri" })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
