import type { PromptTechnique } from "@/lib/ai/types";
import type { TechniqueCategory, TechniqueInfo } from "@/lib/prompt-engine/techniques";

/**
 * German display copy for the technique catalogue (DESIGN.md §8). The engine
 * keeps English names, descriptions and keywords (they also feed the
 * recommender and the generated prompts); the builder shows these instead.
 * Snippets, sources, categories and legacy flags still come from the engine.
 */
export interface TechniqueCopy {
  name: string;
  description: string;
  /** Honest effect statement, as in the engine: no invented numbers. */
  gain: string;
  bestFor: string[];
}

export const TECHNIQUE_DE: Record<PromptTechnique, TechniqueCopy> = {
  "definition-of-done": {
    name: "Definition of Done + Stopp-Regeln",
    description:
      "Lege vorab fest, was „fertig“ heißt: ein messbarer Endzustand, eine benannte Prüfung und die Rahmenbedingungen, auf die es ankommt. Dazu klare Regeln, wann der Agent stoppt und fragt, und eine feste Form für den Abschlussbericht. Funktioniert auch als /goal-Bedingung in Claude Code.",
    gain:
      "Anthropic sieht klare, messbare Erfolgskriterien als Voraussetzung für Prompt Engineering; „Fertig heißt: …“ plus Stopp-Regeln verhindern, dass Agenten zu früh aufhören oder unnötig nachfragen. Eine Zahl ist nicht veröffentlicht.",
    bestFor: ["Migrationen", "Agentisches Coding", "Unbeaufsichtigte Läufe"],
  },
  "verification-loop": {
    name: "Verifikationsschleife (testgetrieben)",
    description:
      "Gib dem Modell eine Prüfung, die es selbst ausführen kann – Tests, Build, Typecheck oder Screenshot-Vergleich. Es arbeitet, bis die Prüfung besteht, behebt Ursachen statt Symptome und belegt das Ergebnis mit Befehl und Ausgabe.",
    gain:
      "Steht in Anthropics Best Practices für Claude Code an erster Stelle: Eine ausführbare Prüfung macht aus einer Session, die man beobachten muss, eine, die man laufen lassen kann. Fehler zeigen sich in der Session statt danach.",
    bestFor: ["Agentisches Coding", "Bugfixes", "Refactoring"],
  },
  "explore-plan-code-commit": {
    name: "Erkunden, Planen, Umsetzen, Committen",
    description:
      "Teilt agentisches Coding in getrennte Phasen: Code lesen, ohne zu ändern; einen prüfbaren Plan mit Dateien, Umfang, Tests und Prüfung schreiben; nach Plan umsetzen; das Ergebnis committen – wie im Plan-Modus von Claude Code.",
    gain:
      "Empfohlen für Änderungen, die sich nicht in einem Satz beschreiben lassen: Das Modell löst nicht vorschnell das falsche Problem, und du bekommst einen Prüfpunkt. Bei Kleinständerungen nur Mehraufwand.",
    bestFor: ["Features über mehrere Dateien", "Unbekannte Codebasen", "Architekturänderungen"],
  },
  "context-engineering": {
    name: "Context Engineering (wenig, aber relevant)",
    description:
      "Gib dem Agenten nur die aussagekräftigsten Informationen: Urteilsvermögen mit Begründung statt starrer Regellisten, Verweise auf Pfade und Befehle statt eingefügter Dumps, keine Widersprüche oder Wiederholungen. Spezialabläufe gehören in Skills oder pfadbezogene Regeldateien.",
    gain:
      "Kontext ist ein begrenztes Aufmerksamkeitsbudget; längere CLAUDE.md-Dateien senken laut Claude-Code-Doku die Befolgung. Der Effekt ist qualitativ: bessere Befolgung, geringere Kosten pro Runde.",
    bestFor: ["System-Prompts", "CLAUDE.md / AGENTS.md", "Lange Sessions"],
  },
  "role-prompting": {
    name: "Rolle / Persona",
    description:
      "Ein Satz im System-Prompt, der Perspektive, Zielgruppe und Qualitätsanspruch nennt. Ergänzt Kontext, Erfolgskriterien und Ausgabeformat, ersetzt sie aber nicht.",
    gain: "Laut Anthropic macht schon ein einziger Satz einen Unterschied; aufwendige Personas sind meist unnötig. Eine Zahl ist nicht veröffentlicht.",
    bestFor: ["Fachspezifische Aufgaben", "Code-Review", "System-Prompts"],
  },
  "few-shot-cot": {
    name: "Few-Shot-Beispiele",
    description:
      "Zeige 3–5 passende, unterschiedliche Beispiele, jeweils in <example> innerhalb von <examples>, mit Eingabe, Lösungsweg und erwarteter Antwort. Beginne mit einem und ergänze weitere nur, wenn die Ausgaben danebenliegen.",
    gain:
      "Laut Anthropic einer der zuverlässigsten Wege, Format, Ton und Struktur zu steuern – sofern die Beispiele passend, vielfältig und strukturiert sind.",
    bestFor: ["Einheitliches Ausgabeformat", "Klassifikation", "Stil treffen"],
  },
  "structured-output": {
    name: "Strukturierte Ausgabe",
    description:
      "Maschinenlesbare Ausgabe nach einem Schema – am besten auf API-Ebene erzwungen (Structured Outputs oder strikte Tools) statt nur per Prompt-Text.",
    gain:
      "Structured Outputs der API garantieren schema-gültiges JSON, reine Prompt-Anweisungen nicht. stop_reason „refusal“ oder „max_tokens“ gilt als Fehler, auch wenn das JSON gültig ist.",
    bestFor: ["API-Antworten", "Datenextraktion", "Pipelines"],
  },
  "long-context-grounding": {
    name: "Langer Kontext + Zitat-Verankerung",
    description:
      "Bei großen Eingaben zuerst die Dokumente – in <documents>/<document> mit Quellenangabe –, Anweisung und Frage ans Ende. Das Modell zieht zuerst relevante Zitate heraus und antwortet nur auf deren Grundlage.",
    gain:
      "Laut Anthropic verbessert die Frage am Ende die Antwortqualität in Tests um bis zu 30 %, besonders bei komplexen Eingaben aus mehreren Dokumenten. Zitate zuerst verringern Halluzinationen.",
    bestFor: ["Lange Dokumente", "Mehrere Dokumente", "Log- und Berichtsanalyse"],
  },
  "scoped-autonomy": {
    name: "Begrenzte Autonomie + Leitplanken",
    description:
      "Der Agent erledigt die Arbeit im vorgesehenen Umfang, trifft Routineentscheidungen selbst und vermeidet Over-Engineering – mit einer klaren Liste schwer umkehrbarer oder nach außen sichtbarer Aktionen, die eine Bestätigung brauchen.",
    gain:
      "Bausteine aus Anthropics Prompting-Doku gegen vorzeitiges Aufhören, unnötige Fragen und riskante Abkürzungen wie --no-verify oder Force-Push. Keine Sicherheitsgrenze: Harte Grenzen gehören in Berechtigungen und Hooks.",
    bestFor: ["Agentisches Coding", "Unbeaufsichtigte Läufe", "Git-Operationen"],
  },
  "evaluator-optimizer": {
    name: "Evaluator-Optimizer (Prüfer mit frischem Kontext)",
    description:
      "Ein Agent erstellt die Arbeit, ein separater Prüfer mit frischem Kontext bewertet sie nach klaren, prüfbaren Kriterien. Der Autor behebt bestätigte Lücken; das wiederholt sich, bis alles besteht oder das Rundenlimit erreicht ist.",
    gain:
      "Laut Anthropic ist ein eigenständiger, skeptischer Prüfer deutlich wirksamer als Selbstkritik. Lohnt sich nur mit klaren Kriterien; bei Routinearbeit kostet es mehr.",
    bestFor: ["Code-Review", "Spezifikationstreue", "Kritische Änderungen"],
  },
  "interview-then-spec": {
    name: "Erst befragen, dann Spezifikation",
    description:
      "Vor dem Bauen befragt dich das Modell gründlich zu Umsetzung, UX, Randfällen und Abwägungen und schreibt dann eine SPEC.md. Eine frische Session setzt die Spezifikation um.",
    gain:
      "Empfohlen für größere Features: Gute Spezifikationen nennen Dateien und Schnittstellen, grenzen den Umfang ab und enden mit einer End-to-End-Prüfung. Weniger falsche Annahmen, bevor Code entsteht.",
    bestFor: ["Unklare Anforderungen", "Neue Features", "Produktplanung"],
  },
  "subagent-orchestration": {
    name: "Orchestrator mit Unteragenten",
    description:
      "Ein leitender Agent teilt große, unabhängige Arbeit in abgegrenzte Teilaufgaben für Unteragenten – jeweils mit Ziel, Ausgabeformat, Tool-Hinweisen und Grenzen. Er prüft die Belege und führt die Ergebnisse zusammen; einfache oder sequenzielle Arbeit bleibt bei ihm.",
    gain:
      "Hält den Hauptkontext sauber, weil Unteragenten verdichtete Zusammenfassungen liefern, und lässt unabhängige Untersuchungen parallel laufen. Zu viel Delegation kostet Zeit und Geld.",
    bestFor: ["Breite Code-Audits", "Parallele Recherche", "Große Migrationen"],
  },
  "completion-promise-loop": {
    name: "Loop mit Abschlusssignal (Ralph)",
    description:
      "Derselbe Prompt läuft wiederholt – in einer Session per Stop-Hook oder serverseitig mit frischem Kontext je Iteration. Der Zustand liegt in Dateien (Fortschrittslog, Aufgabenliste, Git-Historie); der Agent gibt das Abschlusssignal nur aus, wenn die Bedingung objektiv erfüllt ist, und der Harness erzwingt Iterations- und Budgetlimit.",
    gain:
      "Ermöglicht Arbeit über viele Kontextfenster hinweg. Das Ergebnis hängt stark von der Prüfung ab, die nahezu perfekt sein muss; ohne hartes Limit kann ein Loop unbegrenzt Budget verbrauchen.",
    bestFor: ["Lange autonome Arbeit", "Läufe über Nacht", "Backlog abarbeiten"],
  },
  react: {
    name: "ReAct (Denken + Handeln)",
    description:
      "Ein Agent, der Tools direkt aufruft, jedes Ergebnis bewertet und den nächsten Schritt wählt. Für Coding-Agenten passen die Verifikationsschleife oder „Erkunden, Planen, Umsetzen, Committen“ besser.",
    gain:
      "Grundlage werkzeugnutzender Agenten. Aktuelle Modelle rufen Tools nativ auf; wörtliche Thought/Action/Observation-Texte bringen nichts, klare Tool-Beschreibungen umso mehr.",
    bestFor: ["Agenten mit Tools", "Recherche", "Mehrstufige Tool-Nutzung"],
  },
  analogical: {
    name: "An bestehenden Mustern orientieren",
    description:
      "Verweise das Modell auf echten Referenzcode, der ein ähnliches Problem löst, und lass es diesem Muster folgen. Selbst erzeugte Analogien bleiben neuartigen Mathe- oder Logikproblemen ohne Codebasis vorbehalten.",
    gain:
      "Die Claude-Code-Doku empfiehlt, eine bestehende Datei als Vorbild zu nennen. Studien zu selbst erzeugten Analogien stammen von älteren Modellen – mit eigenen Tests nachprüfen.",
    bestFor: ["Features in bestehendem Code", "Konventionen einhalten", "Code aus Spezifikation"],
  },
  decomposition: {
    name: "Zerlegung in Schritte",
    description:
      "Arbeit in Schritte aufteilen: eine Prompt-Kette mit Prüfungen zwischen festen Schritten, ein Orchestrator mit Unteragenten bei unvorhersehbaren Teilaufgaben oder unabhängige, parallele Teile.",
    gain:
      "Mit adaptivem Denken und Unteragenten erledigt Claude die meisten mehrstufigen Überlegungen intern; explizite Ketten helfen, Zwischenergebnisse zu prüfen oder eine Pipeline zu erzwingen.",
    bestFor: ["Mehrstufige Pipelines", "Große Projekte", "Prüfbare Zwischenergebnisse"],
  },
  "step-back": {
    name: "Step-Back (erst das Prinzip)",
    description: "Nenne in einer Zeile das allgemeine Prinzip hinter der Frage und wende es dann auf den konkreten Fall an.",
    gain:
      "Die Studie von 2023 zeigte Gewinne bei wissensintensiven Fragen mit PaLM-2 – mit eigenen Tests nachprüfen. Bei Modellen mit adaptivem Denken geschieht die Abstraktion im Denken; der sichtbare Teil bleibt bei einer Zeile.",
    bestFor: ["MINT-Aufgaben", "Wissensfragen", "Grundprinzipien"],
  },
  "tree-of-thoughts": {
    name: "Tree of Thoughts (mehrere Ansätze)",
    description:
      "Mehrere klar verschiedene Ansätze mit je einer Zeile Begründung vorschlagen; du oder ein separater Prüfer wählt einen, und nur dieser wird umgesetzt.",
    gain:
      "Nützlich, um echte Entwurfsalternativen auszuloten; die Gewinne der Originalstudie betrafen Suchrätsel mit älteren Modellen. Jeder Zweig kostet Tokens – größere Suchen besser als parallele Unteragenten.",
    bestFor: ["Architekturentwurf", "Strategische Planung", "Offene Designentscheidungen"],
  },
  "self-refine": {
    name: "Self-Refine (Entwurf, Prüfung, Überarbeitung)",
    description:
      "Entwerfen, gegen klare Kriterien prüfen, überarbeiten – als getrennte Aufrufe, damit jeder Schritt protokolliert und abgesichert werden kann. Für Kritisches lieber Evaluator-Optimizer mit frischem Prüfer.",
    gain:
      "Die Studie von 2023 zeigte Gewinne mit älteren Modellen. Bei Opus 5 führen pauschale „Prüfe deine Antwort“-Zeilen zu übermäßigem Nachprüfen.",
    bestFor: ["Texte", "Code-Erzeugung", "Feinschliff nach Kriterien"],
  },
  constitutional: {
    name: "Grundsätze + Selbstkritik",
    description: "Grundsätze ruhig formulieren, jeweils mit Begründung, und die Ausgabe in einem eigenen Durchgang dagegen prüfen.",
    gain:
      "Claude überträgt die Begründung hinter einer Regel; Grundsätze mit Begründung halten besser als gebrüllte Regeln. Vage Filter wie „nur schwere Fälle“ senken bei 5.x-Modellen die Trefferquote – erst vollständig erfassen, dann prüfen.",
    bestFor: ["Richtlinien einhalten", "Moderation", "Leitplanken für Chatbots"],
  },
  "meta-prompting": {
    name: "Meta-Prompting",
    description:
      "Das Modell schreibt oder verbessert einen Prompt für ein benanntes Zielmodell – mit wenigen Eingabevariablen, Erfolgskriterien und einem kleinen Testsatz, um Änderungen zu behalten oder zu verwerfen.",
    gain: "Beschleunigt das Entwerfen; die Qualität hängt von den Erfolgskriterien und dem Testsatz ab. Eine Zahl ist nicht veröffentlicht.",
    bestFor: ["Prompt-Bibliothek aufbauen", "Prompt-Optimierung", "Anpassung an andere Modelle"],
  },
  "self-consistency": {
    name: "Self-Consistency (Mehrheitsentscheid)",
    description:
      "Denselben Prompt mehrmals unabhängig laufen lassen – parallel, mit verschiedenen Ansätzen oder Modellen – und die Mehrheitsantwort nehmen. Abgestimmt wird im Harness, nicht in einer einzelnen Antwort.",
    gain:
      "Kostet etwa N-mal so viele Tokens und passt nur zu Aufgaben mit einer prüfbaren Antwort. temperature erzeugt bei Claude 4.7+/5.x keine Vielfalt, andere Werte als der Standard werden abgelehnt.",
    bestFor: ["Kritische Entscheidungen", "Eindeutige Mathe-/Logik-Antworten", "Klassifikation"],
  },
  "chain-of-thought": {
    name: "Chain-of-Thought (CoT)",
    description:
      "Das Modell arbeitet das Problem vor der Antwort durch. Ein Ersatz für Modelle ohne eingebautes Denken; bei Claude-Modellen mit adaptivem Denken stattdessen die Effort-Stufe erhöhen.",
    gain:
      "Hilft bei mehrstufigen Aufgaben, wenn natives Denken fehlt. Bei Claude 5.x kann ein sichtbarer Denkabschnitt abgelehnt werden (reasoning_extraction).",
    bestFor: ["Mehrstufige Aufgaben", "Mathe", "Modelle ohne natives Denken"],
  },
  "zero-shot-cot": {
    name: "Adaptives Denken / Effort (früher Zero-Shot-CoT)",
    description:
      "Die Denktiefe über die Effort-Einstellung des Modells steuern (low bis max), nicht über Prompt-Text. Die dokumentierte Denk-Floskel ist nur ein Ersatz für Modelle ohne eingebautes Denken.",
    gain:
      "Bei Modellen mit adaptivem Denken ist Effort die wichtigste Stellschraube. Ohne „Denke gründlich nach“-Zeilen antwortete Opus 5.5 schneller, ohne erkennbaren Qualitätsverlust. In Claude Code erhöht nur „ultrathink“ das Denken für eine Runde.",
    bestFor: ["Denktiefe", "Schnelle Antworten", "Kosten und Latenz"],
  },
};

export const TECHNIQUE_CATEGORY_LABEL: Record<TechniqueCategory, string> = {
  agentic: "Agentisches Arbeiten",
  quality: "Qualität & Prüfung",
  structure: "Struktur & Kontext",
  reasoning: "Denkansätze",
};

export const COMPLEXITY_LABEL: Record<TechniqueInfo["complexity"], string> = {
  low: "einfach",
  medium: "mittel",
  high: "aufwendig",
};

/** German copy for a technique, falling back to the engine's English text. */
export function techniqueCopy(t: TechniqueInfo): TechniqueCopy & { translated: boolean } {
  const de = TECHNIQUE_DE[t.id];
  return de
    ? { ...de, translated: true }
    : { name: t.name, description: t.description, gain: t.accuracyGain, bestFor: t.bestFor.slice(0, 3), translated: false };
}

/** German name for a technique id (or the id itself when unknown). */
export function techniqueName(id: string): string {
  return (TECHNIQUE_DE as Record<string, TechniqueCopy | undefined>)[id]?.name ?? id;
}
