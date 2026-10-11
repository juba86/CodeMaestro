import { describe, expect, it } from "vitest";
import { repoContextBlock, type GithubRepoBrief } from "./github-repo-context";

const repo: GithubRepoBrief = {
  fullName: "octo/shop",
  private: true,
  push: true,
  url: "https://github.com/octo/shop",
  description: "Webshop",
  defaultBranch: "main",
  language: "TypeScript",
  pushedAt: null,
  rootEntries: ["src/", "package.json"],
  readme: "# Shop\nNext.js app",
};

describe("repoContextBlock", () => {
  it("describes a repository to work in", () => {
    expect(repoContextBlock(repo, "edit")).toBe(
      [
        "GitHub-Repository (bearbeiten): octo/shop",
        "https://github.com/octo/shop · Standard-Branch main · TypeScript · privat",
        "Beschreibung: Webshop",
        "Arbeite in diesem Repository: klone es bzw. nutze den vorhandenen Klon, lies zuerst die bestehende Struktur und halte dich an deren Konventionen. Ändere auf einem eigenen Branch und pushe erst, wenn die Prüfungen grün sind.",
        "Wurzelverzeichnis: src/, package.json",
        "README (Auszug):\n# Shop\nNext.js app",
      ].join("\n"),
    );
  });

  it("marks a reference as read-only and leaves out what is unknown", () => {
    const block = repoContextBlock({ ...repo, private: false, description: "", language: "", rootEntries: [], readme: "" }, "reference");
    expect(block).toBe(
      [
        "GitHub-Repository (nur Referenz): octo/shop",
        "https://github.com/octo/shop · Standard-Branch main · öffentlich",
        "Dieses Repository dient nur als Referenz: lies es, um Aufbau, Konventionen und Lösungen zu übernehmen. Ändere dort nichts und pushe nichts dorthin.",
      ].join("\n"),
    );
  });

  it("warns when the account cannot push to a repository it should edit", () => {
    expect(repoContextBlock({ ...repo, push: false }, "edit")).toContain("kein Schreibrecht");
    expect(repoContextBlock({ ...repo, push: false }, "reference")).not.toContain("kein Schreibrecht");
  });
});
