# Contributing to CodeMaestro

Thanks for your interest in improving CodeMaestro! Contributions of all
sizes are welcome — bug fixes, features, docs, and especially **tests**
(there's no automated suite yet — see [Status & Limitations](./README.md#status--limitations)).

By contributing, you agree that your contributions are licensed under the
project's [GNU AGPL-3.0](./LICENSE).

## Getting started

Requirements and full setup live in the [README](./README.md#getting-started).
The short version:

```bash
git clone https://github.com/Muchel187/CodeMaestro.git
cd CodeMaestro
npm install

cp .env.example .env          # then edit as needed
npx prisma migrate deploy     # create the SQLite schema
npx prisma generate

npm run dev                   # http://localhost:3000
```

## Dev commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) at `http://localhost:3000` |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | Lint with ESLint |

## Code style

- **TypeScript** throughout; keep changes type-safe (no new `any` where it
  can be avoided).
- Run `npm run lint` before opening a PR and fix any warnings you introduce.
- Match the style and naming of the surrounding code.
- Keep changes focused — one logical change per PR makes review easier.
- No stray `console.log` debug output in committed code (use `console.error`
  for genuine error paths only).

## Submitting changes

1. Fork the repo and create a branch from `main`.
2. Make your change, keeping commits focused and messages descriptive.
3. Ensure `npm run lint` and `npm run build` pass.
4. Open a pull request describing **what** changed and **why**.

## Good first issues

New here? Look for issues labeled
[`good first issue`](https://github.com/Muchel187/CodeMaestro/labels/good%20first%20issue).
Writing the first automated tests, docs improvements, and small UI/UX fixes
are great places to start.

## Security

CodeMaestro executes shell commands on the host and is designed for
**trusted, private environments only**. Please review the
[Security](./README.md#security) section before deploying or testing in any
networked setting. If you find a security issue, please report it privately
rather than opening a public issue.
