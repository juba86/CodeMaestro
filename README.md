# PromptBuilder

**An all-in-one workbench for building, testing, and operating LLM prompts — with a multi-model code assistant and orchestrator built in.**

PromptBuilder turns prompt engineering from guesswork into a workflow: structure prompts with proven techniques, lint and score them, test them across **Claude, Gemini, and local Ollama models** side by side, ground them in your own knowledge base, and — when you're ready to *act* — drive Claude Code and Gemini CLI on a real working directory, with a planner that splits work across the best model for each subtask.

It runs entirely on infrastructure you control. Bring API keys, or use your existing Claude/Gemini logins. Run models locally with Ollama for zero marginal cost.

---

## Why PromptBuilder

- **One place for the whole loop** — author → lint → test → compare → save → version → deploy. No copy-pasting between a notepad, three provider playgrounds, and a spreadsheet.
- **Model-agnostic by design** — Claude, Gemini, and any local Ollama model, with live model lists pulled from each provider so you're never stuck on stale IDs.
- **Cost-aware** — token and price estimates per run; route cheap work to free local models and reserve frontier models for the hard parts.
- **Private-first** — self-hosted, SQLite storage, local embeddings. Your prompts, keys, and code never leave your machine/network.
- **From prompt to action** — a built-in code assistant and multi-model orchestrator take a prompt all the way to real file changes in a sandboxed working directory.

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
- **Hardened**: working-directory allowlist with path-traversal guards, conservative tool allowlist (read-only by default; file edits opt-in), per-session permission mode.
- Survives mobile standby — work keeps running server-side and the result is shown when you return.

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
git clone https://github.com/Muchel187/PromptBuilder.git
cd PromptBuilder
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

PromptBuilder is designed to run in a **trusted, private environment** (e.g. localhost or a private Tailscale/VPN network), not exposed to the public internet.

- **The Code Assistant and Orchestrator execute code and shell commands** on the host. Access is sandboxed to an allowlist of working directories (`ASSISTANT_ALLOWED_DIRS`) with path-traversal guards, and tool permissions default to read-only — but anyone who can reach the app can drive these tools. Keep it private.
- API keys entered in Settings are stored in the browser's `localStorage`. In a non-HTTPS context (e.g. plain `http://` on a private IP) they are base64-obfuscated rather than encrypted — treat this as obfuscation, not security. Prefer HTTPS (e.g. `tailscale serve`) or server-side keys for stronger protection.
- No telemetry. Prompts, keys, embeddings, and transcripts stay in your local SQLite DB and browser.

---

## Roadmap / Ideas

- Approval gates per tool call in the assistant
- Prompt A/B testing dashboards and analytics
- Shareable prompt packs / team library
- Pluggable vector backends for larger knowledge bases

---

## License

**Proprietary — All Rights Reserved.** © 2026. See [`LICENSE`](./LICENSE).

This source is shared for viewing/evaluation only. No permission is granted to
use, copy, modify, or distribute the Software without prior written consent of
the copyright holder.
