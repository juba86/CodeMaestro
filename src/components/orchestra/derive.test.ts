import { describe, expect, it } from "vitest";
import { Code, Compass, Database, FlaskConical, Palette, ScanEye, Shield, UserRound } from "lucide-react";
import { defaultOrchestraConfig, type OrchestraWorkerInfo } from "@/lib/assistant/orchestra-types";
import {
  columnOf,
  costHint,
  groupWorkers,
  presetLabel,
  roleIcon,
  rolesByColumn,
  uniqueRoleName,
  usageCounts,
  workerLabel,
  workerShortLabel,
} from "./derive";

const claude: OrchestraWorkerInfo = { id: "claude", kind: "claude-cli", label: "Claude Code", editsFiles: true, local: false, model: "" };
const gemini: OrchestraWorkerInfo = { id: "gemini", kind: "gemini-cli", label: "Gemini CLI", editsFiles: true, local: false, model: "" };
const pi: OrchestraWorkerInfo = { id: "pi:qwen3-coder:30b", kind: "pi", label: "pi · qwen3-coder:30b", editsFiles: true, local: true, model: "qwen3-coder:30b" };
const ollama: OrchestraWorkerInfo = { id: "ollama:qwen3:14b", kind: "ollama", label: "Local: qwen3:14b", editsFiles: false, local: true, model: "qwen3:14b" };
const api: OrchestraWorkerInfo = { id: "api:openai", kind: "api", label: "API: OpenAI", editsFiles: false, local: false, model: "" };

describe("columnOf", () => {
  it("derives Planen / Umsetzen / Prüfen from the defaults", () => {
    const config = defaultOrchestraConfig();
    const cols = rolesByColumn(config);
    expect(cols.plan.map((r) => r.id)).toEqual(["architekt", "recherche"]);
    expect(cols.build.map((r) => r.id)).toEqual(["coder", "tester", "doku"]);
    expect(cols.review.map((r) => r.id)).toEqual(["reviewer"]);
  });

  it("ignores disabled loops, disabled reviewed roles and self-review", () => {
    const config = defaultOrchestraConfig();
    const coder = config.roles.find((r) => r.id === "coder")!;
    const reviewer = config.roles.find((r) => r.id === "reviewer")!;
    expect(columnOf(reviewer, config)).toBe("review");
    coder.enabled = false;
    expect(columnOf(reviewer, config)).toBe("plan");
    coder.enabled = true;
    coder.reviewLoop.enabled = false;
    expect(columnOf(reviewer, config)).toBe("plan");
    coder.reviewLoop = { enabled: true, reviewerRoleId: "coder", maxRounds: 1 };
    expect(columnOf(coder, config)).toBe("build");
  });

  it("puts a file-editing reviewer into Prüfen", () => {
    const config = defaultOrchestraConfig();
    const tester = config.roles.find((r) => r.id === "tester")!;
    config.roles.find((r) => r.id === "coder")!.reviewLoop.reviewerRoleId = "tester";
    expect(columnOf(tester, config)).toBe("review");
  });
});

describe("roleIcon", () => {
  it("matches by id, then by name, then falls back", () => {
    expect(roleIcon({ id: "architekt" })).toBe(Compass);
    expect(roleIcon({ id: "coder-2", name: "Coder 2" })).toBe(Code);
    expect(roleIcon({ id: "x1", name: "Reviewer" })).toBe(ScanEye);
    expect(roleIcon({ id: "qa", name: "Irgendwas" })).toBe(FlaskConical);
    expect(roleIcon({ id: "neue-rolle", name: "Sicherheit" })).toBe(Shield);
    expect(roleIcon({ name: "Frontend" })).toBe(Palette);
    expect(roleIcon({ name: "Datenbank" })).toBe(Database);
    expect(roleIcon({ id: "uebersetzer", name: "Übersetzer" })).toBe(UserRound);
    expect(roleIcon(null)).toBe(UserRound);
  });
});

describe("presetLabel", () => {
  it("labels presets and hand-edited ones", () => {
    expect(presetLabel({ preset: "quality" })).toBe("Qualität");
    expect(presetLabel({ preset: "local" })).toBe("Lokal & günstig");
    expect(presetLabel({ preset: "custom" })).toBe("Eigene Besetzung");
    expect(presetLabel({ preset: "custom" }, "balanced")).toBe("Ausgewogen · geändert");
    expect(presetLabel({ preset: "balanced" }, "quality")).toBe("Ausgewogen");
    expect(presetLabel(null)).toBe("Eigene Besetzung");
  });
});

describe("workers", () => {
  it("gives tier hints", () => {
    expect(costHint(claude)).toBe("stark");
    expect(costHint(gemini)).toBe("frei per Login");
    expect(costHint(pi)).toBe("lokal");
    expect(costHint(ollama)).toBe("lokal");
    expect(costHint(api)).toBe("API");
  });

  it("groups by capability in a fixed order and drops empty groups", () => {
    const groups = groupWorkers([api, ollama, claude, pi]);
    expect(groups.map((g) => g.label)).toEqual([
      "Agenten · dürfen Dateien ändern",
      "Nur Text · lokal",
      "Nur Text · Cloud-API",
    ]);
    expect(groups[0].workers).toEqual([claude, pi]);
    expect(groupWorkers([claude]).map((g) => g.id)).toEqual(["agents"]);
  });

  it("labels workers for display", () => {
    expect(workerLabel(claude)).toBe("Claude Code");
    expect(workerLabel(pi)).toBe("pi · qwen3-coder:30b");
    expect(workerLabel(ollama)).toBe("qwen3:14b");
    expect(workerLabel(api)).toBe("OpenAI");
    expect(workerShortLabel(pi)).toBe("qwen3-coder:30b");
    expect(workerShortLabel({ ...api, model: "gpt-5-mini" })).toBe("gpt-5-mini");
  });

  it("counts usage of the Dirigent and enabled roles", () => {
    const config = defaultOrchestraConfig();
    config.conductor.workerId = "claude";
    for (const r of config.roles) r.workerId = r.editsFiles ? "claude" : "gemini";
    // doku is disabled → not counted
    expect(usageCounts(config)).toEqual({ claude: 3, gemini: 3 });
  });
});

describe("uniqueRoleName", () => {
  it("numbers duplicates case-insensitively", () => {
    const roles = [{ name: "Coder" }, { name: "coder 2" }];
    expect(uniqueRoleName("Coder", roles)).toBe("Coder 3");
    expect(uniqueRoleName("Tester", roles)).toBe("Tester");
    expect(uniqueRoleName("  ", roles)).toBe("Neue Rolle");
  });
});
