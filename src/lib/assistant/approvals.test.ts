import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// approvals.ts optionally notifies via push; keep tests offline and DB-free.
vi.mock("@/lib/push", () => ({ notifySession: vi.fn(async () => {}) }));

import {
  createApproval,
  denyAllPending,
  hookToken,
  isValidHookToken,
  listPending,
  resolveApproval,
  waitForDecision,
  type ApprovalEvent,
} from "./approvals";
import { beginRun, endRun, subscribe } from "./run-hub";

let n = 0;
const sid = () => `approval-session-${++n}`;

function events(sessionId: string): ApprovalEvent[] {
  const sub = subscribe(sessionId, 0, () => {});
  sub?.unsubscribe();
  return (sub?.replay ?? []).map((e) => e.data as unknown as ApprovalEvent);
}

describe("approvals", () => {
  it("denies immediately when no run is active", async () => {
    const r = await createApproval(sid(), "Edit", { file_path: "/x", old_string: "a", new_string: "b" });
    expect(r).toMatchObject({ decision: "deny" });
  });

  it("publishes a request into the run and resolves waiters", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    const r = await createApproval(s, "Bash", { command: "ls -la" });
    expect("approvalId" in r).toBe(true);
    const id = (r as { approvalId: string }).approvalId;

    const req = events(s).find((e) => e.type === "approval_request");
    expect(req).toMatchObject({ approvalId: id, tool: "Bash", command: "ls -la" });
    expect(req?.expiresAt).toBeGreaterThan(Date.now());
    expect(listPending(s).map((e) => e.approvalId)).toEqual([id]);

    const waiting = waitForDecision(id, 5_000);
    expect(resolveApproval(id, "allow")).toBe(true);
    await expect(waiting).resolves.toMatchObject({ decision: "allow" });
    // A decided approval can still be fetched once by a hook that polls late…
    await expect(waitForDecision(id, 10)).resolves.toMatchObject({ decision: "allow" });
    // …but cannot be decided twice.
    expect(resolveApproval(id, "deny")).toBe(false);
    expect(listPending(s)).toEqual([]);
    expect(events(s).some((e) => e.type === "approval_resolved" && e.approvalId === id)).toBe(true);
    endRun(s, run.info.runId, "idle");
  });

  it("returns pending while undecided and unknown for foreign ids", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    const { approvalId } = (await createApproval(s, "Edit", { old_string: "a", new_string: "b" })) as { approvalId: string };
    await expect(waitForDecision(approvalId, 10)).resolves.toBe("pending");
    await expect(waitForDecision("apr_nope", 10)).resolves.toBe("unknown");
    expect(denyAllPending(s)).toBe(1);
    await expect(waitForDecision(approvalId, 10)).resolves.toMatchObject({ decision: "deny" });
    endRun(s, run.info.runId, "stopped");
  });

  it("renders every MultiEdit hunk instead of an empty diff", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    await createApproval(s, "MultiEdit", {
      file_path: "/a.ts",
      edits: [
        { old_string: "one", new_string: "uno" },
        { old_string: "two", new_string: "dos" },
      ],
    });
    const req = events(s).find((e) => e.type === "approval_request")!;
    const text = (req.diff ?? []).map((d) => `${d.op}:${d.text}`);
    expect(text).toEqual(expect.arrayContaining(["del:one", "add:uno", "del:two", "add:dos"]));
    denyAllPending(s);
    endRun(s, run.info.runId, "idle");
  });

  it("diffs a Write against the existing file and flags the overwrite", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cm-approval-"));
    const file = path.join(dir, "pkg.json");
    writeFileSync(file, "line1\nline2\n");
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    await createApproval(s, "Write", { file_path: file, content: "line1\n" });
    const req = events(s).find((e) => e.type === "approval_request")!;
    expect(req.overwrites).toBe(true);
    expect(req.diff?.some((d) => d.op === "del" && d.text === "line2")).toBe(true);
    denyAllPending(s);
    endRun(s, run.info.runId, "idle");
  });

  it("turns AskUserQuestion into a question card", async () => {
    const s = sid();
    const run = beginRun(s, "turn", "pwa");
    await createApproval(s, "AskUserQuestion", {
      questions: [{ question: "Which DB?", header: "DB", options: [{ label: "SQLite" }, "Postgres"] }],
    });
    const q = events(s).find((e) => e.type === "question_request")!;
    expect(q.kind).toBe("ask");
    expect(q.questions?.[0].options.map((o) => o.label)).toEqual(["SQLite", "Postgres"]);
    denyAllPending(s);
    endRun(s, run.info.runId, "idle");
  });

  it("validates the hook token in constant time", () => {
    expect(isValidHookToken(hookToken())).toBe(true);
    expect(isValidHookToken("nope")).toBe(false);
    expect(isValidHookToken(null)).toBe(false);
  });
});
