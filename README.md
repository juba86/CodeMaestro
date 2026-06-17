<div align="center">

# 🎛️ CodeMaestro

### Conduct a fleet of AI coding agents — from anywhere.

Forge structured prompts, then drive **Claude Code**, **Gemini CLI**, and **local models** on a real
working directory — from a self-hosted, phone-friendly PWA you control, with an approval gate and sandbox so you stay in command.

<br>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-2596be.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?logo=pwa&logoColor=white)](#-code-assistant)
[![Self-hosted](https://img.shields.io/badge/Self--hosted-private--first-2ea44f)](#-security)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

<br>

<img src="docs/screenshots/home.png" alt="CodeMaestro home" width="860">

</div>

> [!WARNING]
> **Run it private.** The Code Assistant, Orchestrator, and Telegram bridge execute shell commands on the host. Deploy only on `localhost` or a trusted private network (e.g. Tailscale/VPN) — **never** expose it to the public internet. See [Security](#-security).

CodeMaestro turns AI coding from a single-terminal habit into an operable system: structure prompts with proven techniques, lint and score them, test them across **Claude, Gemini, and local Ollama models** side by side, ground them in your own knowledge base, and — when you're ready to *act* — hand the task to a planner that routes each subtask to the best model and applies real file changes, gated by diffs you approve. It runs entirely on infrastructure you control, installs as a phone-friendly PWA, and can even be driven from **Telegram** when you're away from your network.

---

## Table of Contents

- [Why CodeMaestro](#why-codemaestro)
- [Features](#features)
- [Screenshots](#screenshots)
- [Providers & Auth](#-providers--auth--a-tool-for-everything)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Status & Limitations](#status--limitations)
- [Security](#-security)
- [Roadmap](#roadmap--ideas)
- [License](#license)

---

## Why CodeMaestro

- **Command a fleet, not a terminal** — drive Claude Code and Gemini CLI from the browser or your phone, with session resume, live tool streaming, and a dev-server launcher. Better than a single remote shell.
- **Reachable from anywhere** — installable PWA over Tailscale/VPN, plus an optional **Telegram bridge** so you can kick off and approve work from your phone with no network access at all.
- **Orchestrate by strength** — a planner decomposes big tasks and routes each subtask to the best model: frontier models for hard reasoning, large-context models for sweeps, free local models for isolated work.
- **You stay in command** — opt-in approval gate shows a diff (or the shell command) before any Edit/Write/Bash, with approve / deny / **deny-with-reason** steering, plus a sandbox that confines writes to the project.
- **Model-agnostic by design** — Claude, Gemini, and any local Ollama model, with live model lists pulled from each provider so you're never stuck on stale IDs.
- **Private-first** — self-hosted, SQLite storage, local embeddings. Your prompts, keys, and code never leave your machine/network.

---

## Features

### 🛠️ Prompt Builder
- Structured, XML-based prompt model (instructions, context, constraints, examples, task, audience, output format).
- **14 prompting techniques** with guidance and auto-recommendation — Chain-of-Thought, Zero-/Few-Shot CoT, Self-Consistency, Tree-of-Thoughts, ReAct, Self-Refine, Role Prompting, Structured Output, Meta-Prompting, Constitutional, Step-Back, Analogical, Decomposition.
- **Multi-agent "swarm" config** for designing hierarchical/mesh/ring/star agent topologies.
- Live **XML editor** with tag palette and two-way sync to the structured model.
- **Load & update saved projects** in place — open a library entry back into the builder, edit, and save changes back as a new version.

### ✅ Prompt Quality Linter
- Deterministic scoring (A–F + 0–100) on completeness, specificity, example quality, technique alignment, and XML well-formedness.
- Actionable warnings (missing constraints, vague wording, no output format, examples without reasoning) and a live token/word estimate — no API calls, runs on every keystroke.

### 🧪 Playground & Evaluation
- Run a prompt against any provider/model; **Compare Mode** runs it across Claude, Gemini, and local Ollama at once.
- Per-run **latency, token, and cost** readout.
- **Test-case framework**: define inputs + expected outputs (contains / regex / equals), run them as a regression suite, see pass/fail.

### 📚 Library, Versions & Export
- Save prompts with tags; full **version history** with a colored **diff viewer** between versions.
- One-click **export** to Text, Markdown, JSON, YAML, **Python**, and **TypeScript** (with a ready-to-use `buildPrompt()` function).
- Built-in and custom **templates** with `{{placeholder}}` substitution.

### 🧠 Knowledge Base (RAG)
- Drop in documents; they're chunked and embedded **locally via Ollama (bge-m3)** — nothing leaves the server.
- Semantic search over your knowledge, **"Insert relevant context"** straight into a prompt's context field, and an opt-in **RAG toggle** that auto-augments Code Assistant (and Telegram) turns with the most relevant chunks.
- One shared retrieval path for every channel (search UI, Code Assistant, Telegram) — same model, same scoring, graceful no-op when the index is empty or Ollama is down.

### 🤖 Code Assistant
- Drive **Claude Code** (`claude -p`) and **Gemini CLI** (`gemini -p`) from the browser, on a real working directory.
- Live streaming of assistant text and **tool calls** (Read/Grep/Edit/Bash…), persisted transcripts, **session list & resume**, cost tracking.
- **Approval gate & sandbox**: optionally require approval before every Edit/Write (and Bash) — CodeMaestro streams a **diff** or the **shell command** to the UI; approve, deny, or **deny-with-reason** to steer the model mid-run. An opt-in sandbox confines writes to the working directory.
- **Hardened**: working-directory allowlist with path-traversal guards, conservative tool allowlist (read-only by default; file edits opt-in), per-session permission mode.
- **From anywhere**: installable PWA with a maximizable full-screen chat, file upload, and a one-tap dev-server launcher (start the app, get the link/port, stop it). Survives mobile standby — work keeps running server-side and the result is shown when you return.

### 📲 Telegram Bridge *(optional)*
- Drive the Code Assistant from **Telegram** when you're away from your Tailscale/VPN — same runner, sessions, and approval engine as the PWA, no public webhook required (uses long-polling).
- **Configured entirely in the app** (Settings → Telegram): bot token (kept **server-side**, never in the browser), an **allowed-chat-ID allowlist**, working directory, permission/approval mode, provider/model, and the RAG toggle. Off by default.
- **Inline approval buttons** — approve or deny an edit/Bash command right from the chat, with the diff previewed inline.
- **Per-chat sessions**, **image upload** (send a photo and the assistant reads/processes it), and commands: `/new`, `/sessions`, `/kb <query>`, `/status`, `/stop`, `/whoami`, `/help`.
- Auto-starts on server boot when enabled, so the assistant stays reachable after a restart.

### 🧩 Multi-Model Orchestrator
- Give it a larger task; a **planner** decomposes it and routes each subtask to the **best model for the job** (frontier models for hard reasoning, large-context models for broad sweeps, free local models for isolated work).
- Three modes: **Auto** (fully automatic), **Hybrid** (review the plan and reassign models before running), and **Wizard** (answer a few project questions that bias the plan).
- Executes across the shared working directory and synthesizes a final summary.

### 🔌 Providers & Auth — *a tool for everything*

- **Dedicated:** **Claude** (Anthropic SDK) and **Gemini** (Google GenAI) via API key *or* their logged-in CLI (**OAuth/Login**, no key).
- **Local:** **Ollama** and **LM Studio** auto-discovered (no key), plus a **Custom OpenAI-compatible endpoint** (any base URL — Jan, llama.cpp, vLLM, LocalAI, Azure OpenAI…).
- **Code-Assistant CLI agents:** drive **Claude Code**, **Gemini CLI**, **OpenCode**, **Codex CLI**, and **Aider** on a real working directory.

<details>
<summary><b>Full provider matrix</b> (8 cloud APIs + locals + CLI agents)</summary>

<br>

| Class | Providers | Auth |
|---|---|---|
| **Dedicated** | Claude (Anthropic SDK), Gemini (Google GenAI) | API key **or** CLI OAuth login |
| **OpenAI-compatible** | OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI/Grok, Together, Perplexity | API key, with live `/models` discovery |
| **Local** | Ollama, LM Studio | auto-discovered, no key |
| **Custom** | any OpenAI-compatible base URL (Jan, llama.cpp, vLLM, LocalAI, Azure OpenAI…) | base URL (+ optional key) |
| **CLI agents** | Claude Code, Gemini CLI, OpenCode, Codex CLI, Aider | each uses its own login/config; inert with an install hint until present |

New providers are catalog-driven — adding one is a few lines in `src/lib/ai/catalog.ts`.

</details>

---

## Screenshots

| Prompt Builder | Playground |
|---|---|
| ![Prompt Builder](docs/screenshots/builder.png) | ![Playground](docs/screenshots/playground.png) |

| Templates | Prompt Library |
|---|---|
| ![Templates](docs/screenshots/templates.png) | ![Library](docs/screenshots/library.png) |

| Code Assistant | Knowledge Base |
|---|---|
| ![Assistant](docs/screenshots/assistant.png) | ![Knowledge](docs/screenshots/knowledge.png) |

| Settings & Providers | Home |
|---|---|
| ![Settings](docs/screenshots/settings.png) | ![Home](docs/screenshots/home.png) |

<sub>Screenshots are from a running self-hosted instance (dark theme).</sub>

---

## Getting Started

### Prerequisites
- Node.js **≥ 20.9** (Node 22 recommended)
- For local models: [Ollama](https://ollama.com) running (default `http://localhost:11434`)
- For the Code Assistant: [Claude Code](https://claude.com/claude-code) and/or [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated
- For the Telegram bridge *(optional)*: a bot token from [@BotFather](https://t.me/BotFather)

### Install & run
```bash
git clone https://github.com/Muchel187/CodeMaestro.git
cd CodeMaestro
npm install

cp .env.example .env          # then edit as needed
npx prisma migrate deploy     # create the SQLite schema
npx prisma generate

npm run dev                   # http://localhost:3000
# or, for production:
npm run build && npm start
```

API keys can be entered in the in-app **Settings** page (stored client-side) or set in `.env` — no key is required for Ollama or for Claude/Gemini when using CLI logins.

---

## Configuration

All environment variables are optional; sensible defaults apply.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite database location |
| `ANTHROPIC_API_KEY` | — | Claude API key (fallback if not set in Settings) |
| `GOOGLE_API_KEY` | — | Gemini API key (fallback) |
| `GEMINI_API_KEY` | — | Used by the Gemini CLI worker when not using OAuth login |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama daemon endpoint |
| `OLLAMA_EMBED_MODEL` | `bge-m3:latest` | Embedding model for the knowledge base |
| `ASSISTANT_ALLOWED_DIRS` | parent of the app dir | Colon-separated roots the Code Assistant may operate in |

> The **Telegram bridge** needs no environment variables — it's configured entirely in **Settings → Telegram**, and the bot token is stored server-side only.

---

## Architecture

```
Next.js App (App Router)
├─ UI: Builder · Library · Templates · Playground · Knowledge · Assistant · Settings
├─ API routes
│  ├─ /api/ai/*                  chat · models · validate   (Claude / Gemini / Ollama)
│  ├─ /api/prompts, /templates, /test-results, /knowledge
│  └─ /api/assistant/*           sessions · message (SSE) · orchestrate · workspaces · telegram
├─ lib
│  ├─ ai/                        provider factory, model discovery, pricing, embeddings
│  ├─ prompt-engine/             XML build/parse, techniques, linter, CoT generator
│  ├─ knowledge/                 shared RAG retrieval (embed + cosine)
│  └─ assistant/                 CLI runner, orchestrator, approvals, sandbox, telegram bridge
└─ Prisma + SQLite               prompts, versions, tags, test results/cases, knowledge, sessions, settings
```

The Code Assistant spawns the provider CLIs per turn and streams their `stream-json` output to the browser over SSE; continuity is handled via the CLIs' own session resume. The Telegram bridge reuses that same runner and approval machinery behind a long-poll loop.

---

## Status & Limitations

CodeMaestro is **early-stage and under active development**. It's useful today, but be aware of what is and isn't there yet:

- **Orchestrator is experimental.** The multi-model planner is **prompt-based** (an LLM decomposes the task and picks a worker) — there is **no learned/trained routing**, and subtasks currently run **sequentially**, not in parallel. Review plans (Hybrid mode) for non-trivial work.
- **"deny-with-reason" doesn't close the loop yet.** The reason is **stored and logged**, but **not yet fed back into the model** to steer the next step. Planned, not implemented.
- **Telegram runs one turn at a time.** The bridge processes updates on a single poll loop, so a long turn occupies the bridge until it finishes; for unattended Telegram use, prefer permission mode `acceptEdits` (or the approval gate off) until the turn loop is made concurrent.
- **No automated tests yet.** There is currently no test suite or CI. Changes are validated manually. Contributions here are especially welcome.
- **Security posture is "trusted network only"** — see [Security](#-security). A deliberate design point, not a temporary gap.

---

## 🔒 Security

CodeMaestro is designed to run in a **trusted, private environment** (e.g. localhost or a private Tailscale/VPN network), not exposed to the public internet.

- **The Code Assistant, Orchestrator, and Telegram bridge execute code and shell commands** on the host. Access is sandboxed to an allowlist of working directories (`ASSISTANT_ALLOWED_DIRS`) with path-traversal guards, and tool permissions default to read-only — but anyone who can reach the app can drive these tools. Keep it private.
- **Telegram access is allowlisted** by chat ID (empty allowlist = nobody), and the bot token is stored server-side only — never sent to the browser. Still, treat the bridge as remote shell access and only allowlist chats you trust.
- API keys entered in Settings are stored in the browser's `localStorage`. In a non-HTTPS context they are base64-obfuscated rather than encrypted — treat this as obfuscation, not security. Prefer HTTPS (e.g. `tailscale serve`) or server-side keys for stronger protection.
- No telemetry. Prompts, keys, embeddings, and transcripts stay in your local SQLite DB and browser.

---

## Roadmap / Ideas

- HTTPS via `tailscale serve` for full PWA install + Web Crypto key encryption
- Concurrent Telegram turn handling + closing the deny-with-reason feedback loop
- Parallel subtask execution in the Orchestrator
- Prompt A/B testing dashboards and analytics
- Shareable prompt packs / team library
- Pluggable vector backends for larger knowledge bases

---

## Contributing

Issues and PRs are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`SECURITY.md`](./SECURITY.md). There's no CI yet, so please describe how you tested your change.

---

## License

Released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
© 2026 Jurak Bahrambäk. Free to use, modify, and self-host; network/SaaS use must release source changes.

See [`LICENSE`](./LICENSE) for the full text.
