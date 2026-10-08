/**
 * German display copy for the built-in templates (DESIGN.md §8). The template
 * content itself is prompt text for the model and stays as written; only the
 * gallery's names, descriptions and category labels are translated here.
 * User templates (from the database) are shown as their authors named them.
 */

export const TEMPLATE_CATEGORY_LABEL: Record<string, string> = {
  "agentic-coding": "Agentisches Coding",
  development: "Entwicklung",
  architecture: "Architektur",
  "ai-agents": "KI-Agenten & Schwarm",
  techniques: "Techniken",
};

/** Filter order: the agentic-coding templates first, so they are found. */
export const TEMPLATE_CATEGORY_ORDER = ["agentic-coding", "development", "architecture", "ai-agents", "techniques"];

export function categoryLabel(id: string): string {
  return TEMPLATE_CATEGORY_LABEL[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, " ") : "Sonstige");
}

export const TEMPLATE_DE: Record<string, { name: string; description: string }> = {
  "code-review": {
    name: "Code-Review",
    description: "Systematisches Code-Review mit Blick auf Sicherheit, Performance und Best Practices.",
  },
  debugging: {
    name: "Debugging-Assistent",
    description: "Systematische Fehlersuche mit Ursachenanalyse und Lösungsvorschlägen.",
  },
  "feature-design": {
    name: "Feature-Entwurf",
    description: "Ein neues Feature entwerfen: Architektur, API und Umsetzungsplan.",
  },
  "api-design": {
    name: "API-Design",
    description: "REST- oder GraphQL-APIs entwerfen – mit Endpunkten, Schemas und Fehlerbehandlung.",
  },
  refactoring: {
    name: "Refactoring-Leitfaden",
    description: "Ein Refactoring planen und mit Sicherheitsprüfungen umsetzen.",
  },
  "test-generation": {
    name: "Testgenerierung",
    description: "Umfassende Testsuites mit Randfällen und Mocks erzeugen.",
  },
  "swarm-orchestration": {
    name: "Schwarm-Orchestrierung (ruflo)",
    description: "Einen Multi-Agenten-Schwarm für komplexe KI-Aufgaben nach ruflo-Mustern konfigurieren.",
  },
  "swarm-task-routing": {
    name: "Schwarm-Aufgabenrouting",
    description: "Aufgaben in Multi-Agenten-Systemen nach Komplexität an die passende Stufe verteilen.",
  },
  "tree-of-thoughts": {
    name: "Tree of Thoughts (ToT)",
    description: "Verschiedene Ansätze vergleichen und sich bei komplexen Entscheidungen auf den besten festlegen.",
  },
  "react-agent": {
    name: "ReAct (Denken + Handeln)",
    description: "Agent mit Tools, der vor der Antwort Belege über native Tool-Aufrufe sammelt.",
  },
  "self-refine": {
    name: "Self-Refine (iterativ)",
    description:
      "Einen Entwurf gegen Qualitätskriterien prüfen und eine verbesserte Fassung erstellen – der Prüfschritt einer Kette aus Entwurf, Prüfung und Überarbeitung.",
  },
  "step-back-prompting": {
    name: "Step-Back-Prompting",
    description: "Erst das zugrunde liegende Prinzip benennen, dann auf das konkrete Problem anwenden.",
  },
  decomposition: {
    name: "Aufgabenzerlegung",
    description: "Komplexe Aufgaben in unabhängige Teilaufgaben mit nachverfolgten Abhängigkeiten zerlegen.",
  },
  "constitutional-critique": {
    name: "Grundsätze + Selbstkritik",
    description: "Grundsätze festlegen und die Ausgabe von der KI dagegen prüfen und überarbeiten lassen.",
  },
  "meta-prompting": {
    name: "Meta-Prompting",
    description: "Die KI Prompts für andere Aufgaben erzeugen und optimieren lassen.",
  },
  "agentic-tdd-loop": {
    name: "TDD-Loop (Claude Code)",
    description:
      "Testgetrieben umsetzen: fehlschlagende Tests aus Ein-/Ausgabe-Paaren schreiben und committen, dann implementieren, bis sie bestehen – ohne die Tests zu ändern.",
  },
  "bugfix-repro-first": {
    name: "Bugfix: erst reproduzieren",
    description:
      "Den Fehler untersuchen, mit einem fehlschlagenden Test reproduzieren, die Ursache beheben und die Lösung mit Belegen von vorher und nachher nachweisen.",
  },
  "refactor-with-verification": {
    name: "Refactoring mit festgeschriebenem Verhalten",
    description:
      "Umbauen, ohne das Verhalten zu ändern: Ausgangszustand festhalten, bei dünner Abdeckung Charakterisierungstests ergänzen, in kleinen geprüften Schritten gezielt ändern.",
  },
  "feature-explore-plan-code-commit": {
    name: "Feature: Erkunden, Planen, Umsetzen, Committen",
    description: "Ein Feature in Phasen mit Planfreigabe liefern – nach dem Plan-Modus von Claude Code.",
  },
  "agentic-code-review": {
    name: "Code-Review: erst erfassen, dann prüfen",
    description:
      "Zwei Durchgänge, nur lesend: erst jedes mögliche Problem mit Konfidenz melden, dann jedes mit Belegen bestätigen oder verwerfen. Vermeidet die Trefferverluste, die vage Schweregrad-Filter bei neueren Modellen verursachen.",
  },
  "autonomous-loop-progress-file": {
    name: "Autonomer Loop mit Fortschrittsdatei",
    description:
      "Für den Loop-Modus des Assistenten oder /ralph-loop: Jede Iteration liest die Zustandsdateien, erledigt und prüft eine Aufgabe, committet, protokolliert den Fortschritt und gibt das Abschlusssignal (standardmäßig DONE) erst aus, wenn wirklich alles fertig ist.",
  },
  "frontend-visual-iteration": {
    name: "Frontend: visueller Iterations-Loop",
    description:
      "Eine Oberfläche nach Vorlage umsetzen und mit Screenshots und Interaktionstests wie von Menschen iterieren, bis sie passt.",
  },
  "claude-md-generator": {
    name: "CLAUDE.md-Generator",
    description:
      "Ein Repository erkunden und eine schlanke, überprüfbare CLAUDE.md mit unter 200 Zeilen schreiben. Pfadspezifische Regeln kommen in .claude/rules-Dateien.",
  },
};
