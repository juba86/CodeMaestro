// Ready-made agent jobs for the schedule editor: a name, a rhythm and a task
// that reads well for an unattended run. Client-safe.

import type { ScheduleInput } from "./types";

export interface ScheduleTemplate {
  id: string;
  name: string;
  description: string;
  input: Partial<ScheduleInput> & Pick<ScheduleInput, "name" | "prompt" | "cron">;
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: "nightly-tests",
    name: "Nächtlicher Testlauf",
    description: "Tests, Typecheck und Build nachts; Fehler werden mit vermuteter Ursache gemeldet.",
    input: {
      name: "Nächtlicher Testlauf",
      cron: "0 2 * * *",
      onlyIfChanged: true,
      prompt:
        "Führe die Testsuite, den Typecheck und – falls vorhanden – den Build des Projekts aus (schau in package.json, Makefile oder CI-Konfiguration, was üblich ist). Ändere keinen Code. Berichte knapp: Was lief durch, was schlug fehl, und für jeden Fehler die wahrscheinlichste Ursache mit Datei und Zeile.",
    },
  },
  {
    id: "commit-review",
    name: "Review der neuen Commits",
    description: "Stündlich, nur wenn sich etwas geändert hat: Code-Review der neuen Commits.",
    input: {
      name: "Review der neuen Commits",
      cron: "0 * * * *",
      onlyIfChanged: true,
      prompt:
        "Prüfe die Commits und ungespeicherten Änderungen seit deinem letzten Lauf (git log und git diff; beim ersten Lauf die letzten 24 Stunden). Suche nach Bugs, Sicherheitsproblemen, fehlender Fehlerbehandlung und fehlenden Tests. Ändere keinen Code. Berichte die Funde nach Schwere sortiert, jeweils mit Datei, Zeile und einem konkreten Vorschlag. Keine Funde: sag das in einem Satz.",
    },
  },
  {
    id: "deps-audit",
    name: "Abhängigkeiten prüfen",
    description: "Montags: veraltete und verwundbare Abhängigkeiten mit Empfehlung.",
    input: {
      name: "Abhängigkeiten prüfen",
      cron: "0 8 * * 1",
      prompt:
        "Prüfe die Abhängigkeiten des Projekts auf veraltete Versionen und bekannte Schwachstellen (z. B. npm outdated und npm audit, pip list --outdated, cargo audit – je nach Stack). Installiere nichts und ändere keine Lockfiles. Berichte: sicherheitsrelevante Updates zuerst, dann Major-Updates mit Breaking Changes, dann der Rest – jeweils mit Empfehlung, ob und wann aktualisiert werden sollte.",
    },
  },
  {
    id: "todo-sweep",
    name: "TODO-Sweep",
    description: "Täglich: offene TODO/FIXME-Marker sammeln und priorisieren.",
    input: {
      name: "TODO-Sweep",
      cron: "0 7 * * *",
      onlyIfChanged: true,
      prompt:
        "Sammle alle TODO-, FIXME- und HACK-Marker im Code (ohne node_modules, Build-Ausgaben und Vendor-Ordner). Gruppiere sie nach Bereich, schätze je Eintrag Aufwand und Risiko und nenne die drei, die als Nächstes erledigt werden sollten. Ändere keinen Code.",
    },
  },
  {
    id: "docs-sync",
    name: "Doku aktuell halten",
    description: "Abends, nur bei Änderungen: README und Doku an den Code angleichen.",
    input: {
      name: "Doku aktuell halten",
      cron: "0 18 * * 1-5",
      onlyIfChanged: true,
      prompt:
        "Vergleiche README und Dokumentation mit den Änderungen seit deinem letzten Lauf (git log, git diff). Aktualisiere nur Dokumentationsdateien (README, docs/, Kommentare in Konfigurationsbeispielen), wenn sie dem Code widersprechen oder neue Funktionen fehlen. Ändere keinen Programmcode und committe nicht. Berichte, was du angepasst hast und wo du unsicher warst.",
    },
  },
  {
    id: "lint-fix",
    name: "Lint & Format",
    description: "Nachts, nur bei Änderungen: Lint-Fehler und Formatierung automatisch beheben.",
    input: {
      name: "Lint & Format",
      cron: "30 2 * * *",
      onlyIfChanged: true,
      prompt:
        "Führe Linter und Formatter des Projekts aus (z. B. eslint --fix, prettier, ruff, gofmt – was das Projekt verwendet) und behebe, was sich automatisch beheben lässt. Ändere keine Logik und committe nicht. Berichte, welche Dateien angepasst wurden und welche Lint-Fehler manuell gelöst werden müssen.",
    },
  },
  {
    id: "changelog",
    name: "Changelog-Entwurf",
    description: "Freitags: ein Changelog-Entwurf aus den Commits der Woche.",
    input: {
      name: "Changelog-Entwurf",
      cron: "0 16 * * 5",
      prompt:
        "Erstelle aus den Commits der letzten sieben Tage (git log) einen Changelog-Entwurf, gegliedert in Neu, Geändert, Behoben. Schreibe für Nutzer, nicht für Entwickler, und lass interne Refactorings weg. Lege den Entwurf als Datei CHANGELOG-DRAFT.md im Projektordner ab (überschreibe eine bestehende) und gib ihn im Bericht wieder.",
    },
  },
];

export function scheduleTemplate(id: string): ScheduleTemplate | undefined {
  return SCHEDULE_TEMPLATES.find((t) => t.id === id);
}
