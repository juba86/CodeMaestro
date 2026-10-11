// A GitHub repository as context for a prompt (prompt builder): the types the
// API returns and the text block that goes into the prompt. Pure — shared by
// the server (src/lib/github.ts) and the builder UI.

export interface GithubRepoInfo {
  /** "owner/name" */
  fullName: string;
  private: boolean;
  /** The connected account may push. */
  push: boolean;
  url: string;
  description: string;
  defaultBranch: string;
  language: string;
  pushedAt: string | null;
}

export interface GithubRepoBrief extends GithubRepoInfo {
  /** Entries of the root directory; directories end with "/". */
  rootEntries: string[];
  /** Start of the README ("" when there is none). */
  readme: string;
}

/** "edit": the agent works in the repository; "reference": it only reads it. */
export type GithubRepoMode = "edit" | "reference";

const MODE_HEADING: Record<GithubRepoMode, string> = {
  edit: "GitHub-Repository (bearbeiten)",
  reference: "GitHub-Repository (nur Referenz)",
};

const MODE_RULE: Record<GithubRepoMode, string> = {
  edit:
    "Arbeite in diesem Repository: klone es bzw. nutze den vorhandenen Klon, lies zuerst die bestehende Struktur und halte dich an deren Konventionen. Ändere auf einem eigenen Branch und pushe erst, wenn die Prüfungen grün sind.",
  reference:
    "Dieses Repository dient nur als Referenz: lies es, um Aufbau, Konventionen und Lösungen zu übernehmen. Ändere dort nichts und pushe nichts dorthin.",
};

/** The context block the builder inserts for a repository. */
export function repoContextBlock(repo: GithubRepoBrief, mode: GithubRepoMode): string {
  const facts = [
    repo.url,
    repo.defaultBranch ? `Standard-Branch ${repo.defaultBranch}` : "",
    repo.language,
    repo.private ? "privat" : "öffentlich",
  ].filter(Boolean);
  return [
    `${MODE_HEADING[mode]}: ${repo.fullName}`,
    facts.join(" · "),
    repo.description ? `Beschreibung: ${repo.description}` : "",
    MODE_RULE[mode],
    mode === "edit" && !repo.push ? "Achtung: Das verbundene GitHub-Konto hat hier kein Schreibrecht — Änderungen über einen Fork und Pull Request." : "",
    repo.rootEntries.length ? `Wurzelverzeichnis: ${repo.rootEntries.join(", ")}` : "",
    repo.readme ? `README (Auszug):\n${repo.readme}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
