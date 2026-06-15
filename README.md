# CodeMaestro

**Conduct a fleet of AI coding agents — from anywhere.** A self-hosted control plane that forges optimized prompts, drives Claude Code and Gemini CLI on a real working directory, and orchestrates multiple models by their strengths — with an approval gate and sandbox so you stay in command.

CodeMaestro turns AI coding from a single-terminal habit into an operable system: structure prompts with proven techniques, lint and score them, test them across **Claude, Gemini, and local Ollama models** side by side, ground them in your own knowledge base, and — when you're ready to *act* — hand the task to a planner that routes each subtask to the best model and applies real file changes, gated by diffs you approve.

It runs entirely on infrastructure you control and installs as a phone-friendly PWA, so your whole agent fleet is one tap away over Tailscale/VPN. Bring API keys, or use your existing Claude/Gemini logins. Run models locally with Ollama for zero marginal cost.

---

## Why CodeMaestro

- **Command a fleet, not a terminal** — drive Claude Code and Gemini CLI from the browser or your phone, with session resume, live tool streaming, and a dev-server launcher. Better than a single remote shell.
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
- Semantic search over your knowledge, and **"Insert relevant context"** straight into a prompt's context field.

### 🤖 Code Assistant
- Drive **Claude Code** (`claude -p`) and **Gemini CLI** (`gemini -p`) from the browser, on a real working directory.
- Live streaming of assistant text and **tool calls** (Read/Grep/Edit/Bash…), persisted transcripts, **session list & resume**, cost tracking.
- **Approval gate & sandbox**: optionally require approval before every Edit/Write (and Bash) — CodeMaestro streams a **diff** or the **shell command** to the UI; approve, deny, or **deny-with-reason** to steer the model mid-run. An opt-in sandbox confines writes to the working directory.
- **Hardened**: working-directory allowlist with path-traversal guards, conservative tool allowlist (read-only by default; file edits opt-in), per-session permission mode.
- **From anywhere**: installable PWA with a maximizable full-screen chat, file upload, and a one-tap dev-server launcher (start the app, get the link/port, stop it). Survives mobile standby — work keeps running server-side and the result is shown when you return.

### 🧩 Multi-Model Orchestrator
- Give it a larger task; a **planner** decomposes it and routes each subtask to the **best model for the job** (frontier models for hard reasoning, large-context models for broad sweeps, free local models for isolated work).
- Three modes: **Auto** (fully automatic), **Hybrid** (review the plan and reassign models before running), and **Wizard** (answer a few project questions that bias the plan).
- Executes across the shared working directory and synthesizes a final summary.

### 🔌 Providers & Auth
- **Claude** & **Gemini** via API key, with live model discovery.
- **Gemini via Google Login** (OAuth) instead of an API key — routes through the logged-in Gemini CLI.
- **Ollama** for fully local models — auto-discovered, zero config beyond a running daemon.

---

## Tech Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript**
- **Tailwind CSS v4** · Radix UI · CodeMirror · Zustand
- **Prisma 7** + SQLite (better-sqlite3)
- **@anthropic-ai/sdk** · **@google/genai** · Ollama HTTP API
- Optional CLIs: **Claude Code** and **Gemini CLI** (for the Code Assistant & Orchestrator)

---

## Getting Started

### Prerequisites
- Node.js **≥ 20.9** (Node 22 recommended)
- For local models: [Ollama](https://ollama.com) running (default `http://localhost:11434`)
- For the Code Assistant: [Claude Code](https://claude.com/claude-code) and/or [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

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

---

## Architecture

```
Next.js App (App Router)
├─ UI: Builder · Library · Templates · Playground · Knowledge · Assistant · Settings
├─ API routes
│  ├─ /api/ai/*            chat · models · validate   (Claude / Gemini / Ollama)
│  ├─ /api/prompts, /templates, /test-results, /knowledge
│  └─ /api/assistant/*     sessions · message (SSE) · orchestrate · workspaces
├─ lib
│  ├─ ai/                  provider factory, model discovery, pricing, embeddings
│  ├─ prompt-engine/       XML build/parse, techniques, linter, CoT generator
│  └─ assistant/           CLI runner, orchestrator, sandbox/security
└─ Prisma + SQLite         prompts, versions, tags, test results/cases, knowledge, sessions
```

The Code Assistant spawns the provider CLIs per turn and streams their `stream-json` output to the browser over SSE; continuity is handled via the CLIs' own session resume.

---

## Security

CodeMaestro is designed to run in a **trusted, private environment** (e.g. localhost or a private Tailscale/VPN network), not exposed to the public internet.

- **The Code Assistant and Orchestrator execute code and shell commands** on the host. Access is sandboxed to an allowlist of working directories (`ASSISTANT_ALLOWED_DIRS`) with path-traversal guards, and tool permissions default to read-only — but anyone who can reach the app can drive these tools. Keep it private.
- API keys entered in Settings are stored in the browser's `localStorage`. In a non-HTTPS context (e.g. plain `http://` on a private IP) they are base64-obfuscated rather than encrypted — treat this as obfuscation, not security. Prefer HTTPS (e.g. `tailscale serve`) or server-side keys for stronger protection.
- No telemetry. Prompts, keys, embeddings, and transcripts stay in your local SQLite DB and browser.

---

## Roadmap / Ideas

- HTTPS via `tailscale serve` for full PWA install + Web Crypto key encryption
- Prompt A/B testing dashboards and analytics
- Shareable prompt packs / team library
- Pluggable vector backends for larger knowledge bases

---

## License

**Proprietary — All Rights Reserved.** © 2026. See [`LICENSE`](./LICENSE).

This source is shared for viewing/evaluation only. No permission is granted to
use, copy, modify, or distribute the Software without prior written consent of
the copyright holder.
