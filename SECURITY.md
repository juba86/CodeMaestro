# Security Policy

## ⚠️ Important: CodeMaestro executes code on the host

CodeMaestro's **Code Assistant** and **Multi-Model Orchestrator** spawn CLI
agents that run shell commands and edit files on the machine hosting the app.
Anyone who can reach the web UI can drive those tools.

**Run CodeMaestro only in a trusted, private environment** — localhost or a
private network such as Tailscale/VPN. **Never expose it to the public
internet.** See the [Security section of the README](./README.md#security) for
the full threat model (working-directory allowlist, approval gate, sandbox,
`localStorage` key handling).

## Supported versions

CodeMaestro is pre-1.0 and under active development. Only the latest `main`
branch receives security fixes.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| older commits | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/Muchel187/CodeMaestro/security/advisories/new)
  (Security → Report a vulnerability), or
- a direct message to the maintainer, Jurak Bahrambäk (jurak.bahrambaek@noba-experts.de).

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected version/commit.

You can expect an initial acknowledgement within a few days. Once a fix is
ready, we'll coordinate a disclosure timeline with you and credit you in the
release notes unless you prefer to remain anonymous.
