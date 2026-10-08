import { describe, expect, it } from "vitest";
import {
  activityAriaLabel,
  basename,
  describePending,
  hostLabel,
  openGatesLabel,
  pendingTitle,
  runningText,
  waitingText,
} from "./activity-format";

describe("describePending", () => {
  it("labels file gates with the file name", () => {
    const write = describePending({ type: "approval_request", tool: "Write", filePath: "/p/src/helpers.ts", isWrite: true, overwrites: true });
    expect(pendingTitle(write)).toBe("Datei schreiben: helpers.ts");
    expect(write.detail).toBe("/p/src/helpers.ts");

    const create = describePending({ type: "approval_request", tool: "Write", filePath: "/p/new.ts", isWrite: true, overwrites: false });
    expect(pendingTitle(create)).toBe("Neue Datei anlegen: new.ts");

    const edit = describePending({ type: "approval_request", tool: "Edit", filePath: "C:\\proj\\a.ts" });
    expect(pendingTitle(edit)).toBe("Datei bearbeiten: a.ts");
    expect(describePending({ type: "approval_request", tool: "MultiEdit", filePath: "x/y.md" }).kind).toBe("edit");
  });

  it("labels commands, pushes, questions and plans", () => {
    expect(pendingTitle(describePending({ type: "approval_request", tool: "Bash", command: "npm test" }))).toBe("Befehl ausführen");
    expect(describePending({ type: "approval_request", tool: "Bash", command: "cd x && git push origin main" }).label).toBe(
      "Nach GitHub pushen",
    );
    expect(describePending({ type: "approval_request", tool: "bash", command: "echo git pushy" }).kind).toBe("command");
    expect(pendingTitle(describePending({ type: "question_request", kind: "ask" }))).toBe("Frage");
    expect(pendingTitle(describePending({ type: "question_request", kind: "plan" }))).toBe("Plan");
  });

  it("falls back to the tool label", () => {
    expect(describePending({ type: "approval_request", tool: "WebFetch" }).label).toBe("Web abrufen");
    expect(describePending({ type: "approval_request" }).label).toBe("Freigabe");
  });
});

describe("counts wording", () => {
  it("uses German singular and plural", () => {
    expect(runningText(1)).toBe("1 läuft");
    expect(runningText(2)).toBe("2 laufen");
    expect(waitingText(1)).toBe("1 Freigabe");
    expect(waitingText(3)).toBe("3 Freigaben");
    expect(openGatesLabel(1)).toBe("1 offene Freigabe");
    expect(openGatesLabel(3)).toBe("3 offene Freigaben");
  });

  it("names the activity chip for screen readers", () => {
    expect(activityAriaLabel(1, 1)).toBe("Aktivität: 1 läuft, 1 Freigabe offen");
    expect(activityAriaLabel(2, 0)).toBe("Aktivität: 2 laufen");
    expect(activityAriaLabel(0, 3)).toBe("Aktivität: 3 Freigaben offen");
    expect(activityAriaLabel(0, 0)).toBe("Aktivität: gerade läuft nichts");
  });
});

describe("hostLabel / basename", () => {
  it("keeps the first DNS label", () => {
    expect(hostLabel("noba-server.tail1234.ts.net")).toBe("noba-server");
    expect(hostLabel("localhost")).toBe("localhost");
    expect(hostLabel("100.64.0.7")).toBe("100.64.0.7");
    expect(hostLabel("[::1]")).toBe("[::1]");
    expect(hostLabel("")).toBe("");
  });

  it("takes the last path segment", () => {
    expect(basename("/a/b/c.ts")).toBe("c.ts");
    expect(basename("c.ts")).toBe("c.ts");
    expect(basename("/a/dir/")).toBe("dir");
  });
});
