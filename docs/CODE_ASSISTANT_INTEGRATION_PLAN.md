# Plan: Embedded Code Assistant (Claude Code `-p` / gemini-cli)

> **STATUS: IMPLEMENTED (2026-06-14).** Live at `/assistant`. Claude Code driven via
> `claude -p --output-format stream-json` (per-turn subprocess, `--resume` for
> continuity), gemini-cli driver (`gemini -p --output-format json`). SSE streaming,
> SQLite persistence (`AssistantSession`/`AssistantMessage`), session list + reopen,
> cost tracking, working-dir allowlist + path-traversal guard, conservative tool
> allowlist (Read/Grep/Glob by default; Edit/Write/Bash opt-in). Claude auth uses the
> server's existing `~/.claude` login (no key needed); Gemini uses the stored Google
> key passed as `GEMINI_API_KEY`. Code: `src/lib/assistant/{runner,security}.ts`,
> `src/app/api/assistant/**`, `src/components/assistant/assistant-view.tsx`.
> The design below is the original plan, kept for reference.

---

## Addendum (2026-06-16): Hybrid-Fernsteuerung — PWA primär, Telegram-Fallback

> **STATUS: IMPLEMENTED.** Optionaler Telegram-Bot als zweites Frontend auf dieselbe
> Session-Engine. WhatsApp wurde bewusst zurückgestellt.

**Zielbild.** Die PWA bleibt das primäre Interface (Tailscale-privat). Ist man nicht im
Tailscale, kann man den Assistant **optional** per Telegram steuern/überwachen — kein Zwang,
per Toggle. Alles wird im PWA-UI eingestellt (Settings → Telegram).

**Warum Telegram (statt WhatsApp).** Der Server ist privat, ohne öffentliche Webhook-URL.
Telegram **Long-Polling (`getUpdates`)** funktioniert hinter NAT/privat ohne öffentlichen
Endpunkt; WhatsApp bräuchte öffentlichen Webhook + Meta-Business-Onboarding.

**Architektur.** In-Process Long-Poll-Loop im Next-Node-Runtime, gestartet aus
`src/instrumentation.ts` (Boot-Hook), zur Laufzeit per Settings-Toggle steuerbar. Nutzt
**denselben** `runner.runTurn`-Pfad und dieselbe `approvals.resolveApproval`-Mechanik wie die
PWA. Telegram ist nur ein weiteres Frontend — kein separater Worker.

**Approval-Gate.** `approvals.ts` lehnt ohne Live-Emitter auto-ab. Die Bridge registriert
während eines Telegram-Turns einen Emitter, der Freigaben als Telegram-Inline-Buttons
(Erlauben/Ablehnen) rendert; der Callback löst dasselbe `resolveApproval` aus.

**Sicherheit.** Chat-ID-Allowlist (Pflicht — sonst ist der Bot offen), gleiche
Workdir-Allowlist (`resolveWorkdir`), Token nur serverseitig (im API-Response maskiert).
`/whoami` ist für jeden erlaubt (gibt die eigene Chat-ID zurück), alles andere erfordert
Allowlist.

**Bot-Kommandos.** `/new`, `/sessions`, `/status`, `/stop`, `/whoami`, `/help`; freier Text =
Aufgabe an die aktive Session.

**Dateien.** `src/lib/assistant/telegram.ts` (Bridge + Loop + reine Helfer),
`telegram-config.ts` (Setting-Persistenz), `src/app/api/assistant/telegram/{route,control}.ts`
(Config/Control), `src/components/settings/telegram-settings.tsx` (PWA-UI),
`src/instrumentation.ts` (Auto-Start), Schemas in `validation/schemas.ts`.

---


Ziel: Aus der PromptBuilder-App heraus einen Coding-Assistenten (Claude Code, optional
gemini-cli) auf dem Server starten und steuern — mit **Live-Streaming**, **persistenter
History** und **Wiederaufnahme/Reopen** früherer Sessions. Läuft Tailscale-privat, kein
öffentlicher Zugriff.

---

## 1. Zielbild / UX

Neue Sektion **„Assistant"** (`/assistant`) in der Sidebar:

- **Session-Liste** (links): alle bisherigen Sessions mit Titel, Provider, Arbeitsverzeichnis,
  Datum, Kosten. Klick → öffnet Verlauf.
- **Chat-/Run-Ansicht** (rechts): Nachrichtenverlauf inkl. Tool-Calls (Read/Edit/Bash …),
  Streaming-Tokens live, Statuszeile (Modell, Tokens, $-Kosten).
- **Eingabe**: Prompt-Feld + Auswahl von Provider (`claude` | `gemini`), Modell,
  Arbeitsverzeichnis (`cwd`), Permission-Mode, erlaubte Tools.
- **„Resume"**: jede Session per Knopf fortsetzen; **„Fork"** für alternative Pfade.
- Bonus: einen im PromptBuilder gebauten Prompt direkt als Assistant-Run starten
  („In Assistant öffnen").

---

## 2. Architektur-Entscheidung

**Problem:** Next.js API-Routes sind Request/Response — schlecht für minutenlange,
zustandsbehaftete Agent-Läufe. Zwei tragfähige Wege:

### Option A (empfohlen): Claude **Agent SDK** (TypeScript) in einem separaten Node-Worker
`@anthropic-ai/claude-agent-sdk`, `query({ prompt, options })` als Async-Iterator.
- Kein Subprozess-Startup-Overhead, natives `async/await`, Streaming-Callbacks,
  Tool-Approval-Hooks, mehrere parallele Sessions.
- Läuft **nicht** direkt in der Next-Route, sondern in einem **eigenen langlebigen
  Node-Prozess** („assistant-worker", eigener systemd-User-Service), der eine
  Session-Registry hält. Next spricht ihn über HTTP/SSE oder einen Unix-Socket an.

### Option B: Claude Code **CLI als Subprozess** (`claude -p`)
- `child_process.spawn("claude", ["-p", prompt, "--output-format","stream-json","--verbose", …])`
- Pro: erbt CLAUDE.md/Hooks/Plugins/MCP 1:1, automatische Disk-Persistenz der Transkripte.
- Contra: ~0,5–2 s Startup pro Turn, manuelles Session-ID-Tracking, Streaming nur über
  stdout-Parsing.

**Empfehlung:** **A für Claude** (beste Einbettung), **B für gemini-cli** (SDK fehlt). Beide
hinter einem gemeinsamen `AssistantDriver`-Interface, sodass die App provider-agnostisch bleibt.

```
Browser ──SSE──> Next.js API (/api/assistant/*) ──HTTP/socket──> assistant-worker (Node)
                                                                   ├─ Claude Agent SDK (query)
                                                                   └─ spawn gemini-cli / claude -p
                          │
                          └── Prisma/SQLite (Sessions + Messages gespiegelt)
```

Der Worker ist nötig, weil Sessions länger leben als ein HTTP-Request und über mehrere
Turns/Reconnects hinweg adressierbar sein müssen.

---

## 3. Datenmodell (Prisma)

```prisma
model AssistantSession {
  id           String   @id @default(cuid())
  externalId   String   @unique          // session_id von Claude Code / gemini
  provider     String                    // "claude" | "gemini"
  model        String   @default("")
  title        String   @default("")
  cwd          String                    // Arbeitsverzeichnis
  permissionMode String @default("default")
  allowedTools String   @default("")     // CSV
  status       String   @default("idle") // idle|running|error|done
  totalCostUsd Float    @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  messages     AssistantMessage[]
  @@index([createdAt])
}

model AssistantMessage {
  id        String   @id @default(cuid())
  sessionId String
  role      String   // user|assistant|tool_use|tool_result|system
  content   String   // Text oder JSON (Tool-Input/Result)
  meta      String   @default("{}") // tokens, tool name, ttft …
  createdAt DateTime @default(now())
  session   AssistantSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId])
}
```

History/Reopen: primär aus dieser DB rendern. Zusätzlich kann Claude Codes eigenes
JSONL-Transkript unter `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` als
Source-of-Truth gelesen werden (encoded-cwd = absoluter Pfad, Sonderzeichen → `-`).

---

## 4. API-Routen (Next.js)

| Route | Methode | Zweck |
|-------|---------|-------|
| `/api/assistant/sessions` | GET | Sessions auflisten |
| `/api/assistant/sessions` | POST | Neue Session anlegen (cwd, provider, model, permissionMode, allowedTools) |
| `/api/assistant/sessions/[id]` | GET | Session + Verlauf laden |
| `/api/assistant/sessions/[id]` | DELETE | Session löschen |
| `/api/assistant/sessions/[id]/message` | POST (SSE) | Prompt senden, Antwort **streamen** |
| `/api/assistant/sessions/[id]/stop` | POST | Laufenden Turn abbrechen |
| `/api/assistant/sessions/[id]/fork` | POST | Fork-Session erzeugen |

Streaming an den Browser: **SSE** (`text/event-stream`), wiederverwendet das bestehende
Muster aus `/api/ai/chat`. Events normalisiert: `{type:"text"|"tool_use"|"tool_result"|"cost"|"done"|"error", …}`.

---

## 5. Treiber-Implementierung

### 5a. Claude via Agent SDK
```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const m of query({
  prompt,
  options: {
    cwd, model,
    resume: externalId,                  // Fortsetzen
    permissionMode: "default",            // default|acceptEdits|plan|bypassPermissions
    allowedTools: ["Read","Grep","Glob"], // Edit/Bash nur nach bewusster Freigabe
  },
})) {
  if (m.type === "system" && m.subtype === "init") sessionId = m.session_id; // ID merken
  if (m.type === "result") { /* result + usage + total_cost_usd persistieren */ }
  // content_block_delta(text_delta) → Text streamen; tool_use → Tool-Events
}
```

### 5b. Claude via CLI (Fallback / „bare")
```
claude -p "<prompt>" --output-format stream-json --include-partial-messages --verbose \
  --model <id> --permission-mode default --allowedTools "Read,Grep,Glob" \
  [--resume <session_id>] [--add-dir <path>]
```
stdout zeilenweise als NDJSON parsen: `system/init` (→ `session_id`),
`stream_event` mit `event.type=content_block_delta`/`delta.text_delta` (→ Text),
`tool_use`-Blöcke, abschließendes `result` (Kosten/Usage). cwd via `spawn(..., { cwd })`.

### 5c. gemini-cli (Subprozess)
```
gemini -p "<prompt>" --output-format json   # kein Streaming-JSON; finales Objekt
gemini --resume <uuid>                       # Session fortsetzen
```
Liefert `{response, stats:{model,input_tokens,output_tokens}}` (kein Cost-Breakdown,
kein Streaming) → als ein einzelnes Antwort-Event behandeln. Storage: `~/.gemini/tmp/<hash>/chats/`.

Gemeinsames Interface:
```ts
interface AssistantDriver {
  start(opts): AsyncIterable<NormalizedEvent>   // liefert externalId + Events
  resume(externalId, prompt, opts): AsyncIterable<NormalizedEvent>
  stop(externalId): Promise<void>
}
```

---

## 6. Auth & Secrets

- **Claude:** `ANTHROPIC_API_KEY` als Env im Worker-Service (headless; OAuth/Keychain
  entfällt). Optional `--bare`, dann ausschließlich API-Key, keine Hooks/MCP.
- **Gemini:** entsprechend `GEMINI_API_KEY` / `gcloud`-Credentials.
- Keys **nur serverseitig** (systemd `Environment=` oder `EnvironmentFile=` mit `chmod 600`),
  niemals an den Browser. Optional Spend-Limit `--max-budget-usd`.

---

## 7. Sicherheit / Sandboxing (wichtig)

Der Assistent **führt Code/Shell auf dem Server aus** → bewusst absichern:

1. **Tailscale-only** (bereits gegeben) — keine öffentliche Exposition.
2. **Working-Dir-Whitelist:** nur erlaubte Basis-Verzeichnisse als `cwd`/`--add-dir`
   zulassen (Server-seitige Validierung, kein beliebiger Pfad vom Client).
3. **Permission-Mode konservativ defaulten:** `default` (fragt nach) statt
   `bypassPermissions`; `allowedTools` minimal (Read/Grep/Glob), Edit/Bash explizit opt-in.
4. **Eigener Service-User** mit eingeschränkten Rechten; ggf. systemd-Hardening
   (`ProtectSystem=strict`, `ReadWritePaths=<projektpfade>`, `NoNewPrivileges=yes`).
5. **Budget-/Timeout-Guards** pro Turn; Abbruch-Endpoint.
6. **Audit:** jeden Tool-Call (v.a. Bash) in `AssistantMessage.meta` mitschreiben.

---

## 8. Prozess-Lebenszyklus & Concurrency

- Worker hält `Map<sessionId, RunHandle>`; pro Session max. ein aktiver Turn.
- Mehrere Sessions parallel (SDK: in-process; CLI: je ein Subprozess).
- Reconnect: Browser kann SSE neu verbinden; Worker puffert das laufende Transkript bzur
  Wiederaufnahme. Persistenz nach jedem Event → kein Datenverlust bei Disconnect.
- Cleanup: idle Sessions nach N Minuten beenden; DB bleibt erhalten (Reopen via `--resume`).

---

## 9. UI-Plan

- `src/app/assistant/page.tsx` + `src/components/assistant/*`:
  `assistant-view` (Split-Layout), `session-list`, `chat-thread` (Text + Tool-Cards),
  `run-config` (Provider/Modell/cwd/Tools/Permission), `message-input`.
- Sidebar-Eintrag „Assistant" (Icon `Terminal`/`Bot`).
- Streaming-Anzeige analog `refinement-chat.tsx` (SSE-Reader, Idle-Timeout).
- Tool-Calls als aufklappbare Karten (Name + Input + Result).

---

## 10. Phasen / Rollout

1. **MVP (Claude, einmalig):** Session anlegen, `claude -p --output-format stream-json`
   als Subprozess, Streaming in die UI, Persistenz in DB. (B ist am schnellsten lauffähig.)
2. **Resume/History:** `--resume`, Session-Liste, Reopen aus DB/JSONL.
3. **Agent SDK:** Claude-Treiber auf SDK umstellen (Tool-Hooks, Approvals, weniger Latenz).
4. **Hardening:** Working-Dir-Whitelist, Permission-UI, systemd-Sandbox, Budget-Limits.
5. **gemini-cli-Treiber** hinter demselben Interface.
6. **Politur:** Kosten-Dashboard, „Prompt → Assistant"-Übergabe, Fork, Suche im Verlauf.

---

## 11. Risiken / offene Punkte

- **Langlebige Prozesse in Next:** zwingend ausgelagerter Worker — nicht in Serverless/Route.
- **Sicherheit:** Code-Execution ist die größte Fläche; Sandbox vor breiter Nutzung.
- **gemini-cli** ist headless schwächer (kein Stream-JSON, kein Fork) — Feature-Parität begrenzt.
- **Versions-Drift** der CLIs (Flags ändern sich) → Treiber kapseln, Version pinnen.
- **Transkript-Format** (JSONL) ist intern; bei Bedarf nur über DB rendern.

---

### Referenz (verifiziert, Claude Code v2.1.172)
- Headless-Flags: `-p/--print`, `--output-format text|json|stream-json`,
  `--input-format stream-json`, `--model`, `--permission-mode`, `--allowedTools`,
  `--disallowedTools`, `--add-dir`, `--session-id`, `--resume`, `--continue`,
  `--fork-session`, `--mcp-config`, `--bare`, `--include-partial-messages`,
  `--max-budget-usd`, `--no-session-persistence`, `--append-system-prompt`.
- session_id aus `system/init` (stream-json) bzw. `.session_id` (json).
- Transkripte: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (30 Tage, `cleanupPeriodDays`).
- SDK: `npm i @anthropic-ai/claude-agent-sdk`, `query({prompt, options:{resume, allowedTools, cwd, permissionMode}})`.
- gemini-cli: `gemini -p --output-format json`, `gemini --resume <uuid>`, Storage `~/.gemini/tmp/<hash>/chats/`.
```
