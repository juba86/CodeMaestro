# CodeMaestro design system and page specs

Status: final, approved for implementation (October 2026).
Audience: the agents and people implementing the redesign. UI copy is German; this document is English.

Reference material in [`docs/design/`](design/):

| File | What it shows |
|---|---|
| `mockup-A.html` | The winning mockup. Self-contained (fonts embedded), open it in any browser. Three screens: Assistant mid-run, Orchester org chart, Settings → GitHub. |
| `mockup-A-{desktop,mobile}[-light]-{assistant,orchestra,settings}.png` | Renders at 1440×900 and 390×844, dark and light. |
| `mockup-A-mobile[-light]-orchestra-sheet.png` | Mobile tap-to-assign model sheet. |
| `reference-B-mobile-sticky-approval.png` | Grafted pattern: mobile sticky approval action bar (§6.2.7). |
| `reference-B-mobile-orchestra.png` | Reference only for the mobile org-chart spine; the A list layout wins (§6.3.4). |
| `mockup-A-recipes.css` | Class recipes the mockup used. The CVA strings in §3 supersede them. |

Where the mockup and this document disagree, **this document wins** (the grafts in §0.2 are not in the mockup).

---

## 0. Decision

### 0.1 Winner: Direction A, "Konzertsaal"

Both directions were judged against the brief's criteria.

| Criterion | A "Konzertsaal" | B "Taschen-Dirigent" | Verdict |
|---|---|---|---|
| Steering agents from a phone | Good: list/thread split, tap-to-assign sheet, toasts above tab bar. Approve buttons scroll with the card. | Better: sticky thumb-zone approval bar, global gate banner, activity sheet. | B's mobile gate patterns are grafted onto A. |
| Clarity of run and approval state | One vocabulary, overlay rule for reconnecting, "unknown never shows as Bereit". | Same idea plus a priority rule (pending gate beats running). | A's table plus B's priority rule. |
| Desktop density | No global top bar (48px back to the thread), 13px dense UI, inspector. | Global header plus breadcrumb, 14px UI. | A. |
| Accessibility | Contrast computed per token, 2.5.7 drag alternatives, live regions. | Same depth; stricter on single-key shortcuts. | Tie. A's focused-card shortcuts are allowed by WCAG 2.1.4 ("active only on focus"). |
| Consistency | Tokens compiled and rendered with the project's own Tailwind v4.2.1. | Tailwind v3 CDN stand-in. | A: lower risk on v4. |
| Implementation cost | CSS-grid org chart with fixed sections; HTML-free connectors; no new deps. | Zig-zag 2-column tree with a central trunk; pointer DnD. | A's layout is simpler to build and reflow. |
| Org chart fulfils the user's wish | Dirigent on top, sections Planen / Umsetzen / Prüfen, palette, inspector, live state, presets, review link. | Dirigent plus 2-column roles; zig-zag implies false pairings (B's own critique). | A. |

### 0.2 Grafts from B (all are normative in this document)

1. **Mobile StickyActionBar** for approvals, questions and plans in the thread screen (§6.2.7).
2. **Mobile GateBanner** above the tab bar on every tab-root screen while any gate is open (§5.4).
3. **Activity center as a bottom sheet** on mobile, opened from the activity chip in root app bars (§5.4).
4. **Pending gate beats running** in run-state priority (§4.2).
5. **Overwrite Callout with line count** inside the approval card, and **Bash risk flags** (§6.2.6).
6. **Hint preset chips** in "Mit Hinweis ablehnen" and **no "Alle freigeben"** (§6.2.6).
7. **GitHub-aware push approvals**: a `git push` approval shows a warning with a deep link when GitHub is not connected (§6.2.6).
8. **„Automatisch" is a first-class assignment**: an unassigned role is not an error; the model is picked at run time and the card shows which one (§6.3.7). This matches the backend (`workerId: ""` = Auto).
9. **Workspace pages default to the icon rail below 1600px** (fixes A's own "1440 is tight" finding) (§5.1).
10. **Draft-preserving updates**: composer drafts are saved before the update reload (§6.10).

### 0.3 Things deliberately left out

- `@xyflow/react`, `@dnd-kit`, `cmdk`, Shiki: not needed (§6.3.10, §5.5).
- B's mobile model strip on /orchestra: it hid the role that mattered in B's own render. Per-role sheets instead.
- B's success-green "Freigeben": the primary action is always the brand primary, in both themes.
- A's "Sicherheit" settings section and B's push rules (never-main, draft PRs): **no backend exists**. Listed as phase 2 (§10). The UI never shows controls that do nothing.
- Removing the orphan `/game` route: housekeeping, not part of this redesign.

---

## 1. Principles

| # | Principle | In practice |
|---|---|---|
| 1 | **Gespräch vor Konfiguration** | The thread owns the space. Setup lives in sheets and popovers with remembered defaults. Nothing pushes the composer below the fold. |
| 2 | **Zustand ist überall sichtbar** | One run-state vocabulary (§4). Every open approval or question is counted app-wide, including background and Telegram runs. |
| 3 | **Sicherheit ist explizit** | Approval mode, sandbox and "darf Dateien ändern" are always labelled. Unsafe combinations get an inline warning, never silence. |
| 4 | **Tastatur zuerst, Daumen gleichberechtigt** | ⌘K, focused-card shortcuts, J/K in lists. Every action is also reachable by tap at 40–44px. On the phone, gate decisions sit in the thumb zone. |
| 5 | **Ruhig und dicht** | Neutral surfaces, 13px dense desktop UI, hairline borders, one accent. Motion only means "working". |
| 6 | **Ehrliche Fähigkeiten** | Keep the honest copy ("Freigabe-Gate & Sandbox nur für Claude Code", "kann keine Dateien ändern"). Unknown values are omitted, not faked (no `$0.000`, no invented durations). |
| 7 | **Ein Deutsch, ein Glossar** | All UI copy German, one name per concept (§8). No raw enum values. Code-side labels live in `src/lib/labels.ts`. |

---

## 2. Tokens

### 2.1 `src/app/globals.css` (complete, paste-ready)

This replaces the whole current file. It keeps the shadcn token names so radix/shadcn recipes work, adds surfaces, subtle text, brand text, semantic, diff and provider colours, elevation and motion, and keeps back-compat aliases (`sidebar-*`, `destructive`) so unmigrated code keeps rendering until every package has moved to the new names.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Dark is the default theme: `.dark` on <html>. Light = :root. "System" is
   resolved by the pre-paint script in layout.tsx (§2.8). */
@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Dense desktop UI size (13/20). Tailwind's xs/sm/base/lg/xl/2xl stay. */
  --text-ui: 0.8125rem;
  --text-ui--line-height: 1.25rem;

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-card: var(--card);
  --color-card-foreground: var(--foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary-text: var(--primary-text);
  --color-primary-subtle: var(--primary-subtle);
  --color-primary-border: var(--primary-border);
  --color-secondary: var(--muted);
  --color-secondary-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--foreground);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-success: var(--success);
  --color-success-subtle: var(--success-subtle);
  --color-success-border: var(--success-border);
  --color-warning: var(--warning);
  --color-warning-subtle: var(--warning-subtle);
  --color-warning-border: var(--warning-border);
  --color-danger: var(--danger);
  --color-danger-solid: var(--danger-solid);
  --color-danger-subtle: var(--danger-subtle);
  --color-danger-border: var(--danger-border);
  --color-info: var(--info);
  --color-info-subtle: var(--info-subtle);
  --color-info-border: var(--info-border);

  /* Legacy alias: text-safe danger. Solid fills use bg-danger-solid. */
  --color-destructive: var(--danger);
  --color-destructive-foreground: var(--primary-foreground);

  /* Legacy sidebar aliases (old sidebar.tsx). Remove once nothing uses them. */
  --color-sidebar: var(--surface);
  --color-sidebar-foreground: var(--foreground);
  --color-sidebar-accent: var(--accent);
  --color-sidebar-accent-foreground: var(--foreground);
  --color-sidebar-border: var(--border);
  --color-sidebar-primary: var(--primary);
  --color-sidebar-primary-foreground: var(--primary-foreground);
  --color-sidebar-ring: var(--ring);

  --color-diff-add: var(--diff-add);
  --color-diff-add-strong: var(--diff-add-strong);
  --color-diff-del: var(--diff-del);
  --color-diff-del-strong: var(--diff-del-strong);

  /* Provider marks: decorative dots, always next to a text label. */
  --color-prov-claude: var(--prov-claude);
  --color-prov-gemini: var(--prov-gemini);
  --color-prov-local: var(--prov-local);
  --color-prov-api: var(--prov-api);

  --radius-sm: 0.25rem;  /*  4: badges inside text, kbd, inline code */
  --radius-md: 0.375rem; /*  6: buttons, inputs, chips */
  --radius-lg: 0.5rem;   /*  8: cards, list rows */
  --radius-xl: 0.75rem;  /* 12: composer, dialogs, popovers, toasts */
  --radius-2xl: 1rem;    /* 16: bottom-sheet top corners */

  --shadow-xs: var(--elev-1);
  --shadow-sm: var(--elev-2);
  --shadow-md: var(--elev-3);
  --shadow-lg: var(--elev-4);

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}

/* ---------- Light ---------- */
:root {
  color-scheme: light;
  --radius: 0.5rem;
  --background: oklch(0.99 0.002 275);
  --surface: oklch(0.975 0.003 275);
  --surface-2: oklch(0.955 0.004 275);
  --card: oklch(1 0 0);
  --popover: oklch(1 0 0);
  --muted: oklch(0.955 0.004 275);
  --accent: oklch(0.945 0.006 275);
  --foreground: oklch(0.21 0.012 275);
  --muted-foreground: oklch(0.45 0.014 275);
  --subtle-foreground: oklch(0.51 0.014 275);
  --border: oklch(0.91 0.005 275);
  --border-strong: oklch(0.84 0.008 275);
  --input: oklch(0.66 0.012 275);
  --ring: oklch(0.55 0.2 277);

  --primary: oklch(0.51 0.21 277);
  --primary-foreground: oklch(0.99 0 0);
  --primary-text: oklch(0.49 0.2 277);
  --primary-subtle: oklch(0.51 0.21 277 / 9%);
  --primary-border: oklch(0.51 0.21 277 / 35%);

  --success: oklch(0.5 0.13 155);
  --success-subtle: oklch(0.5 0.13 155 / 9%);
  --success-border: oklch(0.5 0.13 155 / 30%);
  --warning: oklch(0.52 0.12 65);
  --warning-subtle: oklch(0.75 0.15 75 / 16%);
  --warning-border: oklch(0.6 0.13 70 / 40%);
  --danger: oklch(0.53 0.2 27);
  --danger-solid: oklch(0.55 0.21 27);
  --danger-subtle: oklch(0.53 0.2 27 / 8%);
  --danger-border: oklch(0.53 0.2 27 / 30%);
  --info: oklch(0.5 0.13 240);
  --info-subtle: oklch(0.5 0.13 240 / 9%);
  --info-border: oklch(0.5 0.13 240 / 30%);

  --diff-add: oklch(0.6 0.15 155 / 12%);
  --diff-add-strong: oklch(0.45 0.13 155);
  --diff-del: oklch(0.6 0.2 27 / 10%);
  --diff-del-strong: oklch(0.5 0.2 27);

  --prov-claude: oklch(0.62 0.14 45);
  --prov-gemini: oklch(0.58 0.15 255);
  --prov-local: oklch(0.55 0.1 160);
  --prov-api: oklch(0.55 0.02 275);

  --elev-1: 0 1px 2px oklch(0.2 0.01 275 / 6%);
  --elev-2: 0 1px 2px oklch(0.2 0.01 275 / 6%), 0 2px 8px -2px oklch(0.2 0.02 275 / 8%);
  --elev-3: 0 8px 24px -8px oklch(0.2 0.02 275 / 18%), 0 2px 6px -2px oklch(0.2 0.02 275 / 8%);
  --elev-4: 0 24px 64px -16px oklch(0.2 0.02 275 / 28%);
  --scrim: oklch(0.2 0.01 275 / 40%);
  --grid-dot: oklch(0.21 0.012 275 / 9%);

  /* Height of fixed bottom chrome (tab bar, composer, action bar). Set at
     runtime by useBottomChrome(); toasts sit above it. */
  --cm-bottom-chrome: 0px;
}

/* ---------- Dark (default) ---------- */
.dark {
  color-scheme: dark;
  --background: oklch(0.16 0.005 275);
  --surface: oklch(0.18 0.006 275);
  --surface-2: oklch(0.215 0.007 275);
  --card: oklch(0.2 0.007 275);
  --popover: oklch(0.225 0.008 275);
  --muted: oklch(0.235 0.008 275);
  --accent: oklch(0.25 0.01 275);
  --foreground: oklch(0.97 0.003 275);
  --muted-foreground: oklch(0.74 0.01 275);
  --subtle-foreground: oklch(0.65 0.012 275);
  --border: oklch(0.29 0.008 275);
  --border-strong: oklch(0.37 0.01 275);
  --input: oklch(0.5 0.012 275);
  --ring: oklch(0.72 0.16 277);

  --primary: oklch(0.56 0.2 277);
  --primary-foreground: oklch(0.99 0 0);
  --primary-text: oklch(0.78 0.12 277);
  --primary-subtle: oklch(0.62 0.19 277 / 14%);
  --primary-border: oklch(0.66 0.18 277 / 40%);

  --success: oklch(0.76 0.15 155);
  --success-subtle: oklch(0.76 0.15 155 / 12%);
  --success-border: oklch(0.76 0.15 155 / 30%);
  --warning: oklch(0.82 0.14 80);
  --warning-subtle: oklch(0.82 0.14 80 / 11%);
  --warning-border: oklch(0.82 0.14 80 / 32%);
  --danger: oklch(0.72 0.18 25);
  --danger-solid: oklch(0.58 0.2 27);
  --danger-subtle: oklch(0.72 0.18 25 / 12%);
  --danger-border: oklch(0.72 0.18 25 / 32%);
  --info: oklch(0.76 0.11 235);
  --info-subtle: oklch(0.76 0.11 235 / 12%);
  --info-border: oklch(0.76 0.11 235 / 30%);

  --diff-add: oklch(0.7 0.15 155 / 11%);
  --diff-add-strong: oklch(0.8 0.14 155);
  --diff-del: oklch(0.7 0.18 25 / 11%);
  --diff-del-strong: oklch(0.78 0.15 25);

  --prov-claude: oklch(0.72 0.13 45);
  --prov-gemini: oklch(0.72 0.13 255);
  --prov-local: oklch(0.74 0.11 160);
  --prov-api: oklch(0.7 0.02 275);

  --elev-1: 0 1px 0 oklch(1 0 0 / 3%) inset;
  --elev-2: 0 1px 0 oklch(1 0 0 / 4%) inset, 0 1px 3px oklch(0 0 0 / 40%);
  --elev-3: 0 1px 0 oklch(1 0 0 / 5%) inset, 0 12px 32px -8px oklch(0 0 0 / 60%);
  --elev-4: 0 1px 0 oklch(1 0 0 / 6%) inset, 0 24px 64px -12px oklch(0 0 0 / 70%);
  --scrim: oklch(0.08 0.005 275 / 62%);
  --grid-dot: oklch(1 0 0 / 6%);
}

@layer base {
  * { @apply border-border; }
  html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
  body {
    @apply bg-background text-foreground antialiased;
    font-feature-settings: "ss01", "cv11";
  }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  ::selection { background: var(--primary-subtle); }
}

/* "Working" motion. Use only behind motion-safe: (see §2.7). */
@keyframes cm-sweep { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes cm-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes cm-dash { to { stroke-dashoffset: -16; } }
@utility animate-sweep { animation: cm-sweep 1.6s var(--ease-standard) infinite; }
@utility animate-breathe { animation: cm-breathe 2s ease-in-out infinite; }
@utility animate-dash { animation: cm-dash 0.8s linear infinite; }

@utility pt-safe { padding-top: env(safe-area-inset-top); }
@utility pb-safe { padding-bottom: env(safe-area-inset-bottom); }
@utility pl-safe { padding-left: env(safe-area-inset-left); }
@utility pr-safe { padding-right: env(safe-area-inset-right); }
@utility scrollbar-none { scrollbar-width: none; &::-webkit-scrollbar { display: none; } }
@utility canvas-grid {
  background-image: radial-gradient(var(--grid-dot) 1px, transparent 1px);
  background-size: 16px 16px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 2.2 Token reference

Contrast measured with an OKLCH → sRGB → WCAG script, text against `--background` unless noted.

| Token | Light | Dark | Use | Contrast L / D |
|---|---|---|---|---|
| `background` | 0.99 0.002 275 | 0.16 0.005 275 | App background, thread | — |
| `surface` | 0.975 | 0.18 | Sidebar, session list, inspector, run bar | — |
| `surface-2` | 0.955 | 0.215 | Wells: code, diff header, segmented track, user prompt block | — |
| `card` | 1 0 0 | 0.2 | Cards | — |
| `popover` | 1 0 0 | 0.225 | Popovers, sheets, toasts, menus | — |
| `muted` / `accent` | 0.955 / 0.945 | 0.235 / 0.25 | Muted fill / hover and selected row | — |
| `foreground` | 0.21 | 0.97 | Text | 17.2 / 17.8 |
| `muted-foreground` | 0.45 | 0.74 | Secondary text | 7.2 / 8.4 |
| `subtle-foreground` | 0.51 | 0.65 | Meta text. **Lightest colour allowed for text.** | ≥4.9 on every surface incl. `accent` in both themes |
| `border` | 0.91 | 0.29 | Decorative dividers, card outlines | n/a |
| `border-strong` | 0.84 | 0.37 | Outline buttons, button-like slots, org-chart wires | n/a |
| `input` | 0.66 | 0.5 | **Only** text-entry outlines, select triggers, switch/checkbox boundaries | ≥3.0 vs bg and card (1.4.11) |
| `ring` | 0.55 0.2 277 | 0.72 0.16 277 | Focus outline, 2px + 2px offset | 5.0 / 7.5 |
| `primary` | 0.51 0.21 277 | 0.56 0.2 277 | Primary button, selected chip, running | white text 6.0 / 4.8 |
| `primary-text` | 0.49 0.2 277 | 0.78 0.12 277 | Links, active nav icon, brand text, running label | 6.6 / 9.5 |
| `primary-subtle` / `primary-border` | 9% / 35% | 14% / 40% | Selection and live tints | primary-text on subtle: 5.9 / 7.5 |
| `success` | 0.5 0.13 155 | 0.76 0.15 155 | Done, diff add | 5.4 / 9.6 |
| `warning` | 0.52 0.12 65 | 0.82 0.14 80 | Waiting, reconnecting, overwrite | 5.5 / 11; on its subtle over card 5.0 / 8.3 |
| `danger` | 0.53 0.2 27 | 0.72 0.18 25 | Error text and icons, diff del | 5.7 / 7.1 |
| `danger-solid` | 0.55 0.21 27 | 0.58 0.2 27 | **Fills only** (danger button) | white text 5.3 / 4.6 |
| `info` | 0.5 0.13 240 | 0.76 0.11 235 | Telegram origin, hints | 5.7 / 9.2 |

Rules:
- Text never uses `danger-solid` (4.1:1 on dark). `text-destructive` is now an alias for `text-danger`; migrate to `danger` names when touching a file.
- Semantic text on its own `*-subtle` fill stays ≥4.5:1 in both themes.
- Never use raw palette classes (`text-blue-400`, `bg-green-600`, `violet-300`, `amber-500`, …). Every colour comes from a token.

### 2.3 Run-state colour map

Components never pick colours for states themselves; they use `RUN_STATE_META[state].tone` (§4.3).

| Tone | Text/icon | Fill | Border | States |
|---|---|---|---|---|
| `brand` | `primary-text` | `primary-subtle` | `primary-border` (dashed for background) | running, background, loop paused |
| `warning` | `warning` | `warning-subtle` | `warning-border` (dashed for reconnecting) | waiting_*, reconnecting, offline |
| `info` | `info` | `info-subtle` | `info-border` | telegram |
| `success` | `success` | `success-subtle` | `success-border` | done |
| `danger` | `danger` | `danger-subtle` | `danger-border` | error |
| `neutral` | `subtle-foreground` | `surface-2` | `border-strong` | idle, stopping, stopped, unknown |

### 2.4 Typography (Geist / Geist Mono)

| Class | Size / line height | Weight | Use |
|---|---|---|---|
| `text-2xl` | 24/32, `tracking-[-0.015em]` | 600 | Home greeting only |
| `text-xl` | 20/28, `tracking-[-0.01em]` | 600 | Page title (h1) |
| `text-lg` | 18/26 | 600 | Section title (h2) |
| `text-base` | 16/24 | 400/500 | **Mobile:** form fields (prevents iOS zoom), list primary text, sheet titles |
| `text-sm` | 14/22 | 400 | Reading text: thread prose, descriptions. Mobile thread prose is `text-[15px]/6`. |
| `text-ui` | 13/20 | 400/500 | Dense desktop UI: buttons, rows, labels, nav |
| `text-xs` | 12/16 | 400/500 | Meta, badges, captions, kbd. **Absolute minimum** (also for tab-bar labels and count badges). |
| `font-mono` | 12–13 / 20 | 400 | Paths, diffs, commands, IDs |

- **Font wiring fix**: the `next/font` variable classes (`geistSans.variable`, `geistMono.variable`) go on `<html>`, not `<body>`, and `<body>` gets `font-sans`. Today Geist never renders (the screenshots show the system fallback) because Tailwind's preflight resolves the font stack on `html`, where `--font-geist-sans` is undefined.
- Weights 400, 500, 600 only. Sentence case; no ALL-CAPS overlines.
- Changing numbers (timers, costs, counts, iteration n/m) always `tabular-nums`.
- Safety-relevant explanations (sandbox, approval, autonomy) are at least `text-ui` (13px), never 11px.
- Prose max width 760px (thread) / 720px (forms) / 70ch (descriptions).

### 2.5 Spacing and sizing

- 4px grid. Steps: 2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48.
- Card padding 12 (dense) or 16. Page gutter 16 mobile, 24 tablet, 24–32 desktop.
- **Control heights**: one component switches per breakpoint (mobile first, `md:` = ≥768px).

| Size | Mobile | Desktop (`md:`) | Use |
|---|---|---|---|
| `xs` | 28 | 24 | Only inside dense tables and diff headers (desktop) |
| `sm` | 36 | 28 | Secondary toolbar buttons, chips |
| `md` (default) | 40 | 32 | Buttons, inputs, selects, segmented controls |
| `lg` | 44 | 40 | Primary mobile actions, sheet footers |
| `xl` | 48 | 40 | Sticky action bar buttons (mobile) |
| `icon-sm` / `icon` / `icon-lg` | 32 / 40 / 44 | 28 / 32 / 40 | Icon buttons |

- Every interactive element has a hit area ≥24×24 (WCAG 2.5.8) with spacing; primary mobile actions ≥44px.
- Row heights: session row ≥56 (mobile) / 64 (3-line rows), list row ≥44, settings row ≥48, tab bar 56 + safe area, mobile app bar 56 + safe area, desktop pane header 48.

### 2.6 Radii, elevation, z-order

- Radii: `rounded-sm` 4 (kbd, inline code, badges inside text), `rounded-md` 6 (buttons, inputs, chips), `rounded-lg` 8 (cards, rows), `rounded-xl` 12 (composer, dialogs, popovers, toasts), `rounded-t-2xl` 16 (bottom sheets), `rounded-full` (pills, dots, avatars).
- Elevation: `shadow-xs` card · `shadow-sm` raised card, approval card · `shadow-md` popover, menu, drag ghost · `shadow-lg` dialog, sheet, toast (plus `--scrim` overlay). In dark mode depth comes mostly from the lighter surface step plus a 1px border.
- Z-order: content 0 · sticky in-pane bars 10 · app bar 20 · tab bar 30 · GateBanner 35 · popover/menu 40 · sheet/dialog 50 · toast (sonner) above all.

### 2.7 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| instant | 80ms | standard | Press feedback |
| fast | 120–150ms | `ease-standard` | Hover, colour, toggles |
| base | 180ms | `ease-enter` | Popover, tooltip, menu, card expand |
| slow | 260ms (exit 0.7×, `ease-exit`) | `ease-enter` | Sheet, dialog |
| layout | 300ms | standard | Org-chart re-layout after add/remove |

"Working" motion is limited to: `motion-safe:animate-sweep` (2px progress sweep under the active role card or run bar), `motion-safe:animate-breathe` (running dot), `motion-safe:animate-dash` (active review link), `motion-safe:animate-spin` (reconnecting icon, button spinners).

Reduced motion: every decorative animation is behind `motion-safe:`; the global rule in §2.1 stops the rest. Sheets fade instead of slide. Auto-scroll uses `behavior: "auto"`. The state is always also in text ("arbeitet · 0:42"). New approval cards never animate layout; they are announced (§7).

### 2.8 Theming

- Store: `useSettingsStore().theme` (`"dark" | "light" | "system"`, default `"dark"`) stays the source of truth.
- `ThemeController` (client component rendering null) applies it: toggles `.dark` on `<html>`, follows `matchMedia("(prefers-color-scheme: dark)")` for `system`, mirrors the value to `localStorage["cm-theme"]`, and updates `<meta name="theme-color">` (dark `#0d0d0f`, light `#fbfcfd`).
- Pre-paint script (inline `<script>` in `<head>` of `layout.tsx`, before first paint): reads `localStorage["cm-theme"]` inside try/catch and sets `.dark` accordingly (resolving `system` with `matchMedia`); default dark. `<html lang="de" className={cn(geistSans.variable, geistMono.variable, "dark")} suppressHydrationWarning>`, `<body className="font-sans antialiased">`.
- Toggle UI: sidebar footer icon button (cycles Dunkel → Hell → System, `aria-label` names the next state), Mehr sheet on mobile, and Settings → Allgemein as a SegmentedControl (System / Dunkel / Hell). The old header toggle disappears.
- `manifest.ts` `background_color` / `theme_color`: `#0d0d0f`.

---

## 3. Primitives (`src/components/ui`)

Built on the unified `radix-ui` package plus `class-variance-authority` and `cn` from `@/lib/utils`. All primitives:
- forward `ref` and `className`, use tokens only, show the 2px `ring` focus outline;
- accept German copy from the caller (no English defaults in rendered text);
- render the same component on mobile and desktop with breakpoint-based sizes.

### 3.1 Inventory

| File | Exports | Base | Variants × sizes | Notes |
|---|---|---|---|---|
| `button.tsx` | `Button`, `buttonVariants`, `IconButton` | `Slot` (asChild) | `primary`, `secondary`, `outline`, `ghost`, `danger`, `danger-outline`, `danger-ghost`, `link` × `xs`, `sm`, `md`, `lg`, `xl`, `icon-sm`, `icon`, `icon-lg` | `loading` keeps the label, adds a Spinner and `aria-busy`. `disabledReason?: string` renders `aria-disabled` (stays focusable), suppresses clicks and shows the reason in a Tooltip and via `aria-describedby`. Disabled = 50% opacity, no fill change. `IconButton` requires `aria-label` (typed). Optional `kbd` prop renders a `Kbd` inside. |
| `input.tsx` | `Input`, `InputGroup` (leading/trailing slots) | native | `sm`, `md`, `lg` | `text-base md:text-ui`. `aria-invalid` → danger border. |
| `textarea.tsx` | `Textarea` | native | `autosize?: {min, max}` rows | Same type rules as Input. |
| `secret-input.tsx` | `SecretInput` | InputGroup | — | Reveal toggle (`aria-pressed`), copy optional. |
| `field.tsx` | `Field`, `FieldLabel`, `FieldHint`, `FieldError`, `useFieldControl` | context | — | Generates an id; wires `htmlFor`, `aria-describedby` (hint + error), `aria-invalid`. Every form control goes through it. |
| `select.tsx` | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SimpleSelect` | radix Select | `sm`, `md`, `lg` | Items accept `description` and a trailing badge slot. `SimpleSelect({ options: {value,label,description?,disabled?}[], value, onValueChange, placeholder, size, aria-label? })` for one-liners. Replaces every native `<select>`. |
| `checkbox.tsx` | `Checkbox` | radix Checkbox | — | 20px box, 24px hit area. |
| `radio-group.tsx` | `RadioGroup`, `RadioGroupItem`, `RadioCard` | radix RadioGroup | — | `RadioCard` = whole card is the item; title, description, optional badge, `tone="danger"` for unsafe options. |
| `switch.tsx` | `Switch`, `SwitchRow` | radix Switch | `sm`, `md` | Off track uses `--input` boundary. `SwitchRow` = label + description + switch, the whole row is the click target (≥44px mobile). |
| `segmented-control.tsx` | `SegmentedControl`, `SegmentedItem` | radix ToggleGroup (single) | `sm`, `md` | Never allows deselecting to empty. Optional icon and trailing dot (modified). |
| `toggle-chip.tsx` | `ToggleChip` | radix Toggle | `default`, `brand` × `sm`, `md` | `aria-pressed`. Tool chips, Wissen, filters. |
| `badge.tsx` | `Badge` | span | `neutral`, `brand`, `success`, `warning`, `danger`, `info`, `outline` × `sm`, `md` | Optional leading icon or dot. |
| `status-badge.tsx` | `StatusBadge`, `StatusIcon` | Badge | takes `state: RunState`, optional `detail` (e.g. "4:12"), `size` | Icon + label + tone from §4.3. Never colour alone. `StatusIcon` is the icon-only form for dense lists (with `aria-label`). |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | div | `default`, `interactive`, `inset`, `warning`, `danger`, `selected`, `live` | `live` = `primary-subtle` tint plus a sweep bar slot. `selected` = 2px ring-coloured outline (distinct from `live`). |
| `callout.tsx` | `Callout` | div | `info`, `success`, `warning`, `danger` | `role="status"` (info/success) or `role="alert"` (warning/danger only when it appears in response to an action). Icon, title, body, optional action slot. ≥13px text. |
| `empty-state.tsx` | `EmptyState` | div | — | Icon, title, one sentence, primary action, optional secondary. |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | radix Tabs | `underline`, `pill` | Optional count badge in triggers. |
| `dialog.tsx` | `Dialog*` | radix Dialog | — | Focus trap, Esc, restore focus. |
| `alert-dialog.tsx` | `AlertDialog*` | radix AlertDialog | `tone: default/danger` | — |
| `confirm.tsx` | `confirm(opts): Promise<boolean>`, `ConfirmHost` | AlertDialog | — | Imperative replacement for `window.confirm`: `if (!(await confirm({ title, description, confirmLabel: "Löschen", tone: "danger" }))) return;`. `ConfirmHost` is mounted once in `layout.tsx`. |
| `sheet.tsx` | `Sheet*` | radix Dialog | `side: "right" \| "bottom" \| "auto"` | `auto` = bottom below `md`, right from `md`. Bottom: grabber, `max-h-[92dvh]`, `rounded-t-2xl`, footer pads `pb-safe`. Right: 420px (or `size="lg"` 560px). |
| `popover.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`, `hover-card.tsx` | radix wrappers | radix | — | Tooltip: 400ms delay, also on focus, never the only carrier of information. Each Tooltip brings its own Provider (no ordering requirement). |
| `scroll-area.tsx`, `separator.tsx`, `skeleton.tsx`, `kbd.tsx`, `spinner.tsx` | — | radix / div | — | Spinner is `motion-safe:animate-spin`, static icon otherwise, always with text or `aria-label`. |
| `progress.tsx` | `Progress`, `SegmentedProgress` | div | — | `SegmentedProgress({ segments: ("done"\|"current"\|"waiting"\|"failed"\|"pending"\|"paused")[] })`, max 20 segments, else a bar plus text. `role="progressbar"` with `aria-valuenow/max` and `aria-valuetext` ("Iteration 4 von 10"). |
| `countdown.tsx` | `Countdown` | — | `ring`, `text` | Props `expiresAt` (epoch ms), `now`. "läuft ab in 4:32". Below 60s turns danger and reads "Läuft gleich ab". Announces via its own polite live region only at 60s and 15s. |
| `diff-view.tsx` | `DiffView` | — | — | Input `DiffPart[]` (`@/lib/assistant/approvals`). Line numbers, +/− gutter, add/del backgrounds, unchanged runs > 6 lines collapsed ("31 unveränderte Zeilen", expandable). Desktop no-wrap with horizontal scroll; mobile wraps (`whitespace-pre-wrap break-words`) with a "Umbrechen / Scrollen" toggle remembered in localStorage. `maxLines` with "Ganzen Diff anzeigen". |
| `code-block.tsx` | `CodeBlock`, `CommandBlock` | — | — | Mono, copy button, optional title. `CommandBlock` shows `cwd` and an optional "Sandbox an · nur Projektordner" line. |
| `provider-mark.tsx` | `ProviderMark` | span | — | 8px dot (`prov-*`) + label. `providerTone(kindOrProvider)` helper maps `claude-cli/claude → claude`, `gemini-cli/gemini → gemini`, `ollama/pi/lmstudio → local`, else `api`. |
| `model-picker.tsx` | `ModelPicker` | Popover + listbox (desktop), Sheet (mobile) | — | Generic, no fetching. Props: `items: {id, label, sublabel?, group, tone, editsFiles?, costTier?, disabledReason?, recommended?}[]`, `value`, `onValueChange`, `filter?: (item) => string \| null` (returns a hide reason), `title` (sheet title, e.g. „Modell für ‚Tester'"), `hint?`, `allowAuto?` (adds "Automatisch"). Shows grouped items, typeahead filter, "n Modelle ausgeblendet · trotzdem zeigen" (then disabled with reason). Mobile sheet footer: [Abbrechen] [Zuweisen]. |
| `page-header.tsx` | `PageHeader` | header | — | `title`, `description?`, `actions?`, `meta?`. Renders the page's single `h1`; below `md` the h1 is `sr-only` because the shell AppBar shows the title visually (§5.3). |
| `app-bar.tsx` | `AppBar` | header | — | Mobile app bar: `pt-safe`, 56px row, `back?: {href, label}`, `title`, `subtitle?`, `actions?`. Used by the shell and by custom screens (assistant thread, orchestra). |
| `toaster.tsx` | `Toaster`, `useBottomChrome(ref, enabled = true)` | sonner | — | Desktop bottom-right; mobile bottom-center with `offset bottom = calc(var(--cm-bottom-chrome) + 12px)`. `useBottomChrome` registers a fixed bottom element (TabBar, GateBanner, composer, StickyActionBar), measures it with a ResizeObserver (so safe-area padding is included) and sets `--cm-bottom-chrome` on `<html>` to the sum of all registered, visible elements; it unregisters on unmount. Toast styling via `toastOptions.classNames` with tokens (`bg-popover`, `border-border`, `shadow-lg`, `rounded-xl`); `theme` follows the resolved app theme. |

Theme files (also foundation): `src/components/theme/theme-controller.tsx` (`ThemeController`, `useResolvedTheme`), `theme-script.tsx` (`ThemeScript`, the pre-paint inline script), `theme-toggle.tsx` (`ThemeToggle` icon cycle button and `ThemeSegmented`).

Hooks (foundation): `src/hooks/use-media-query.ts` (`useMediaQuery(q)`, `useIsMobile()` = `(max-width: 767px)`), `src/hooks/use-now.ts` (`useNow(intervalMs = 1000)`, shared ticking clock).

### 3.2 CVA recipes (normative)

```ts
// button.tsx
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium " +
  "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 " +
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        secondary: "bg-muted text-foreground hover:bg-accent",
        outline: "border border-border-strong bg-card text-foreground hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        danger: "bg-danger-solid text-white hover:bg-danger-solid/90",
        "danger-outline": "border border-danger-border text-danger hover:bg-danger-subtle",
        "danger-ghost": "text-danger hover:bg-danger-subtle",
        link: "h-auto px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 px-2 text-xs md:h-6",
        sm: "h-9 px-3 text-xs md:h-7 md:px-2.5",
        md: "h-10 px-3.5 text-sm md:h-8 md:px-3 md:text-ui",
        lg: "h-11 px-4 text-sm md:h-10",
        xl: "h-12 px-4 text-base md:h-10 md:text-sm",
        "icon-sm": "size-8 md:size-7",
        icon: "size-10 md:size-8",
        "icon-lg": "size-11 md:size-10",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

// badge.tsx
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-medium leading-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-border-strong bg-surface-2 text-muted-foreground",
        brand: "border-primary-border bg-primary-subtle text-primary-text",
        success: "border-success-border bg-success-subtle text-success",
        warning: "border-warning-border bg-warning-subtle text-warning",
        danger: "border-danger-border bg-danger-subtle text-danger",
        info: "border-info-border bg-info-subtle text-info",
        outline: "border-border-strong text-muted-foreground",
      },
      size: { sm: "h-5 px-2 text-xs", md: "h-6 px-2.5 text-xs" },
    },
    defaultVariants: { variant: "neutral", size: "sm" },
  }
);

// input.tsx (Textarea uses the same minus height)
const inputVariants = cva(
  "flex w-full rounded-md border border-input bg-background px-3 text-base text-foreground " +
  "placeholder:text-subtle-foreground md:text-ui disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  { variants: { size: { sm: "h-9 md:h-7", md: "h-10 md:h-8", lg: "h-11 md:h-10" } }, defaultVariants: { size: "md" } }
);
```

Other recipes:
- **Segmented track**: `inline-flex h-10 md:h-8 items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5`. Item: `h-full rounded-[5px] px-3 md:px-2.5 text-ui font-medium text-muted-foreground hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm`.
- **ToggleChip**: `h-9 md:h-7 rounded-md border border-border px-2.5 md:px-2 text-xs font-medium text-muted-foreground hover:bg-accent data-[state=on]:border-primary-border data-[state=on]:bg-primary-subtle data-[state=on]:text-primary-text`.
- **Switch**: track `h-5 w-9 rounded-full border border-input bg-muted data-[state=checked]:border-primary data-[state=checked]:bg-primary`; thumb `size-3.5 rounded-full bg-muted-foreground data-[state=checked]:translate-x-4 data-[state=checked]:bg-white`. Mobile hit area via `SwitchRow`.
- **Nav item**: `flex h-10 md:h-8 items-center gap-2.5 rounded-md px-2 text-ui text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground [&[aria-current=page]_svg]:text-primary-text`.
- **Card**: `rounded-lg border border-border bg-card shadow-xs`.
- **Kbd**: `inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong bg-surface-2 px-1 font-mono text-xs leading-none text-muted-foreground`; inside a primary button: `border-white/25 bg-white/10 text-primary-foreground`.
- **Diff row**: grid `[2.25rem_1.25rem_1fr]`; add row `bg-diff-add text-diff-add-strong`; del row `bg-diff-del text-diff-del-strong`; line numbers `text-subtle-foreground select-none`.

---

## 4. Run-state model (one vocabulary)

### 4.1 Module

`src/lib/run-state.ts` (pure, unit-tested) exports:

```ts
export type RunState =
  | "idle" | "running" | "background" | "telegram"
  | "waiting_approval" | "waiting_answer" | "waiting_plan"
  | "loop_paused" | "stopping" | "stopped" | "done" | "error" | "unknown";

export type ConnectionOverlay = "reconnecting" | "offline" | null;

export interface RunStateInput {
  run?: { kind: "turn" | "orchestrate" | "loop"; origin: "pwa" | "telegram"; startedAt: number } | null;
  pending?: { type: string; kind?: "ask" | "plan" }[];   // ApprovalEvent-like
  loopResumeAt?: number | null;
  stopping?: boolean;
  /** This device is attached to the run's stream (the session is open here). */
  attached?: boolean;
  lastEnd?: { status: "idle" | "error" | "stopped"; at?: number; error?: string } | null;
  /** DB status from the sessions list ("running" | "idle" | "error" | …). */
  sessionStatus?: string;
  /** The client lost track (poll budget exhausted, fetch failing). */
  stale?: boolean;
  connection?: "live" | "reconnecting" | "offline";
  now?: number;
}

export function deriveRunState(i: RunStateInput): { state: RunState; overlay: ConnectionOverlay };
export const RUN_STATE_META: Record<RunState, {
  label: string; icon: LucideIconName; tone: "brand" | "warning" | "info" | "success" | "danger" | "neutral";
  motion: "breathe" | null; dashed?: boolean;
}>;
export function isActive(s: RunState): boolean;      // running/background/telegram/waiting_*/loop_paused/stopping
export function isWaiting(s: RunState): boolean;     // waiting_*
```

### 4.2 Derivation and priority (first match wins)

1. `stopping` → **stopping**.
2. Active run and a pending item: `kind: "plan"` → **waiting_plan**; question → **waiting_answer**; approval → **waiting_approval**. (Pending gates beat running, B graft.)
3. Active run, `kind === "loop"` and `loopResumeAt > now` → **loop_paused**.
4. Active run, `origin === "telegram"` → **telegram**.
5. Active run, `attached` → **running**; not attached → **background**.
6. No active run, `stale` or (`sessionStatus === "running"` but the client cannot confirm) → **unknown**. Never fall back to idle.
7. `lastEnd.status === "error"` → **error**; `"stopped"` → **stopped**; `"idle"` within 24h of `lastEnd.at` → **done**.
8. Otherwise **idle**.

The connection is an overlay, not a state: `connection === "offline"` → overlay `offline`; `"reconnecting"` → overlay `reconnecting`. UIs show the overlay next to (not instead of) the last known state.

Origin (App / Telegram) and kind (Turn / Orchester / Loop) are secondary text, never the main state.

### 4.3 Table

| State | Icon (lucide) | Tone | Label | Motion |
|---|---|---|---|---|
| idle | `Circle` | neutral | Bereit | — |
| running | `LoaderCircle` (or dot) | brand | Läuft | breathe dot, sweep bar |
| background | `Server` | brand, dashed | Läuft im Hintergrund | breathe |
| telegram | `Send` | info | Läuft · via Telegram | breathe |
| waiting_approval | `ShieldAlert` | warning | Wartet auf Freigabe | none; Countdown |
| waiting_answer | `MessageCircleQuestion` | warning | Wartet auf Antwort | — |
| waiting_plan | `ListChecks` | warning | Plan wartet auf Freigabe | — |
| loop_paused | `Timer` | brand | Loop pausiert · weiter um 14:32 | — |
| stopping | `Square` | neutral | Wird gestoppt … | — |
| stopped | `Square` (filled) | neutral | Gestoppt | — |
| done | `CircleCheck` | success | Abgeschlossen (after 24h: Bereit, with "zuletzt 14:02") | — |
| error | `CircleX` | danger | Fehler (short reason on a second line) | — |
| unknown | `CircleHelp` | neutral | Status unbekannt · **Erneut prüfen** | — |
| overlay reconnecting | `RefreshCw` | warning, dashed | Verbindung wird wiederhergestellt … (Versuch 2) | spin (motion-safe) |
| overlay offline | `WifiOff` | warning | Offline – Anzeige kann veraltet sein | — |

Loop end reasons (`loop_end.reason`):

| Reason | Text | Tone |
|---|---|---|
| `promise` | Ziel erreicht nach 6 Iterationen | success |
| `max` | Maximum erreicht (10 Iterationen) – Ziel evtl. nicht erfüllt | warning |
| `stopped` | Gestoppt nach Iteration 3 | neutral |
| `error` | Fehler in Iteration 4 | danger |

### 4.4 App-wide activity

`GET /api/assistant/activity` (new, read-only, `runtime = "nodejs"`) aggregates the in-memory run hub:

```ts
// response
{
  serverTime: number;
  runs: { sessionId: string; title: string; cwd: string; provider: string; model: string;
          kind: "turn" | "orchestrate" | "loop"; origin: "pwa" | "telegram"; startedAt: number }[];
  pending: { sessionId: string; sessionTitle: string; approvalId: string;
             type: "approval_request" | "question_request"; kind?: "ask" | "plan";
             tool?: string; filePath?: string; command?: string; isWrite?: boolean;
             overwrites?: boolean; expiresAt?: number }[];
}
```

Implementation: recent sessions from Prisma (id, title, cwd, provider, model; newest 200), then `getActiveRun(id)` and `listPending(id)` per session. No diffs in this payload (they can be large); the assistant loads full cards from the session.

`useActivity()` (`src/hooks/use-activity.ts`) is the single client source for counts: polls every 5s while the document is visible, refreshes on `visibilitychange`, `online` and on demand (`refresh()`), shares one poller across all subscribers (module-level store with `useSyncExternalStore`), and returns `{ runs, pending, counts: { running, waiting }, reachable, loading, lastUpdated, refresh }`. `reachable === false` after two failed polls → shell shows the offline overlay.

---

## 5. Layout and navigation

### 5.1 Breakpoints

| Range | Shell | Assistant |
|---|---|---|
| `< 768` (phone) | Per-screen AppBar (56 + `safe-area-inset-top`) and bottom TabBar (56 + `safe-area-inset-bottom`). | `/assistant` = session list screen; `/assistant?session=<id>` = thread screen (AppBar and TabBar hidden, custom thread bar). Inspector = bottom Sheet. |
| `768–1023` | Sidebar collapsed to a 56px icon **rail** with tooltips. | Two panes: list (collapsible, ⌘\\) + thread. Inspector = right Sheet. |
| `1024–1279` | Sidebar 232px (collapsible, persisted, ⌘B). | List 276 + thread. Inspector = right Sheet via `PanelRight` button. |
| `≥ 1280` | Sidebar 232px. **On `/assistant` and `/orchestra` the sidebar defaults to the rail below 1600px**; the user's explicit choice is remembered per page. | List 276 + thread (flex, content ≤760) + inspector 300. |

- Use `h-dvh` / `min-h-dvh`, never `h-screen`.
- AppBar pads `pt-safe`. TabBar, composer, sticky action bar and sheet footers pad `pb-safe` (use `max(env(safe-area-inset-bottom), 8px)` where a floor is needed). Landscape uses `pl-safe`/`pr-safe` on the shell.
- `appleWebApp.statusBarStyle` stays `"black"` (the current safe choice); the AppBar still pads for the inset so `black-translucent` can be adopted later without layout changes.

### 5.2 Desktop sidebar

There is **no global top bar on desktop**. Each page has its own 48px pane header (`PageHeader` or a workspace header).

Top to bottom:
1. Brand: baton glyph tile (primary, 28px) + "CodeMaestro" + collapse `IconButton` (`PanelLeftClose`, "Seitenleiste einklappen").
2. Search button: `Suchen & springen …` + `Kbd ⌘K` (Ctrl K on non-Mac). Opens the palette.
3. **Aktivität chip** (only when `counts.running + counts.waiting > 0`): `● 1 läuft · ⚠ 1 Freigabe ›`. Opens the Activity popover (§5.4).
4. Nav (no group label): **Start** (`House`) · **Assistent** (`SquareTerminal`; warning count badge for waiting gates, brand dot while something runs) · **Orchester** (`Network`).
5. Group "Prompts": **Builder** (`Hammer`) · **Bibliothek** (`Library`) · **Vorlagen** (`LayoutTemplate`) · **Playground** (`FlaskConical`).
6. Group "Kontext": **Wissensbasis** (`BookOpen`).
7. Footer: **Einstellungen** (`Settings`); server line `● <host> · online` (or `offline`, warning); `PushToggle` (icon form); `ThemeToggle`.

Rail mode: icons only (40px targets), tooltips with label and shortcut, the activity chip becomes an icon button with a count dot, the search button an icon.

**Installed desktop app (Window Controls Overlay)**: the manifest enables `window-controls-overlay`. In `@media (display-mode: window-controls-overlay)` the shell renders a draggable strip of height `env(titlebar-area-height, 0px)` across the content column (`app-region: drag`; all buttons and links inside `no-drag`) and the sidebar brand row is draggable too, so the OS window controls never cover pane headers.

### 5.3 Mobile shell

**TabBar**: **Start · Assistent · Orchester · Prompts · Mehr**. 56px + safe area, icon (24px) over a 12px label, active = `primary-text` icon and label plus a 2px top indicator, `aria-current="page"`.
- Assistent badge: warning count of open gates (12px text, min 18px circle, `aria-label` "3 offene Freigaben"), or a brand dot while anything runs.
- Prompts is active on `/builder`, `/library`, `/templates`, `/playground` and opens `/library`. On those four routes the shell shows a **Prompts hub nav** (SegmentedControl, horizontally scrollable: Bibliothek · Builder · Vorlagen · Playground) under the AppBar.
- Mehr opens a bottom Sheet: Wissensbasis · Einstellungen · Design (ThemeSegmented) · Push-Benachrichtigungen (PushToggle row) · App-Version (from `package.json`).

**AppBar** (default, rendered by the shell from the nav config): title of the current section; right side: activity chip (compact `●1 ⚠1`, only when active, opens the Activity sheet) and a search IconButton (palette, full-screen on mobile).
- Pages render `PageHeader` as usual; its h1 is `sr-only` below `md`, its description and actions stay visible.
- Screens with their own bar (assistant thread, orchestra) hide the shell AppBar and/or TabBar with `useShellChrome({ appBar: false, tabBar: false })` (§9.2).

### 5.4 Activity: chip, popover/sheet, GateBanner

**Activity popover** (desktop, from the sidebar chip) / **Activity sheet** (mobile, from the AppBar chip):
- **Wartet auf dich**: one row per pending item: kind icon, „Datei schreiben: helpers.ts" / „Frage" / „Plan", session title, Countdown, [Öffnen] → `/assistant?session=<id>`. No blind approve here: deciding needs the diff.
- **Läuft**: session title, StatusBadge, elapsed (`tabular-nums`), origin ("in der App" / "via Telegram"), kind ("Loop 4/10" when known).
- Empty: "Gerade läuft nichts."

**GateBanner** (mobile only, B graft): on every tab-root screen (TabBar visible) while `pending.length > 0`, a 48px warning bar sits directly above the TabBar: `⚠ Freigabe nötig · Auth-Refactor · 4:12   [Öffnen]`; several: `⚠ 3 Freigaben warten   [Ansehen]` (opens the Activity sheet). Updates `--cm-bottom-chrome` so toasts stay above it.

### 5.5 Command palette (⌘K / Ctrl+K, or `/` when no field has focus)

Built on `Dialog` with an input and a filtered listbox (`role="listbox"`, `aria-activedescendant`, arrow keys, Enter, Esc). No `cmdk` dependency. Full-screen on mobile (search icon in the AppBar).

| Group | Items |
|---|---|
| Springen | Start, Assistent, Orchester, Builder, Bibliothek, Vorlagen, Playground, Wissensbasis, Einstellungen and each settings section (`/settings?section=github` …) |
| Sessions | Recent sessions (from `/api/assistant/sessions`), active ones first with StatusIcon |
| Aktionen | Neue Session (`/assistant?new=1`), Offene Freigabe öffnen (first pending), Orchester bearbeiten, Design wechseln (cycles theme), Push-Benachrichtigungen, Tastenkürzel anzeigen |

### 5.6 Shortcuts (help sheet on `?`)

| Shortcut | Action | Owner |
|---|---|---|
| `⌘K` / `Ctrl K`, `/` | Palette | shell |
| `⌘B` | Sidebar ein/aus | shell |
| `G` then `A` / `O` / `S` / `B` / `L` / `H` | Assistent / Orchester / Einstellungen / Builder / Bibliothek / Start | shell |
| `?` | Shortcut help | shell |
| `N` | Neue Session | assistant |
| `J` / `K` | Next / previous session | assistant |
| `⌘\` | Session list ein/aus | assistant |
| `⌘↵` / `Ctrl↵` | Senden | assistant composer |
| `⌘.` | Lauf stoppen | assistant |
| `A` / `D` / `H` **while an approval card has focus** | Freigeben / Ablehnen / Mit Hinweis ablehnen | assistant |
| `⌘S` | Speichern | orchestra, builder |
| `Esc` | Close the top layer | all |

Single-key shortcuts never fire while focus is in an input, textarea, select or contenteditable, or while a modal is open (`useHotkeys` in §9.2 enforces this). Card shortcuts are active only while the card has focus (WCAG 2.1.4 exception).

### 5.7 Toasts

Sonner via the `Toaster` primitive. Desktop: bottom-right. Mobile: bottom-center, lifted by `--cm-bottom-chrome` above TabBar, GateBanner, composer or action bar. Never top-center (covers the back button). Update and error toasts that need an action use `duration: Infinity`. Undo toasts: 6s.

---

## 6. Page specs

### 6.1 `/` Start (home dashboard)

**Desktop** (12-column grid, max width 1200):
- Header: greeting (`text-2xl`, "Guten Morgen" / "Guten Tag" / "Guten Abend" by local time) and a **status strip** of chips, each linking to its settings section; problems turn warning or danger:
  `● <host> · online` · `Provider 4/13` · `Telegram aktiv` · `GitHub verbunden` (or warning "GitHub nicht verbunden") · `Wissensbasis bereit` (or neutral "Wissensbasis leer") · `Push an/aus`.
- Left 8 columns:
  - **Wartet auf dich** (only when pending): compact warning cards: kind, target (mono), session, Countdown, [Öffnen]. No blind approve.
  - **Läuft** (only when runs): session cards: StatusBadge, elapsed, loop progress (SegmentedProgress) when known, origin.
  - **Zuletzt**: 5 recent sessions (StatusIcon, title, folder, relative time) and 5 recently updated prompts (title, version, relative time), as two lists.
- Right 4 columns:
  - **Schnellstart**: [Neue Session] (primary, `/assistant?new=1`) with the 3 most recent project folders as chips (`/assistant?new=1&cwd=<path>`), [Prompt bauen], [Vorlage verwenden], [Orchester bearbeiten].
  - **Orchester**: `OrchestraSummaryCard variant="home"` (active preset, roles as chips, [Bearbeiten]).
  - **Nutzung (7 Tage)**: number of sessions updated, and summed `totalCostUsd` only if > 0 ("lokal: 0 $" is not shown).
- **First run** (no sessions and no configured provider): an "Einrichten" checklist card replaces the left column: Provider verbinden ✓/○ · Erste Session starten · GitHub verbinden · App installieren · Telegram (optional). Each item links.

**Mobile**: single column in this order: Wartet auf dich → Läuft → Schnellstart (2×2 grid of 64px tiles: Neue Session · Prompt bauen · Orchester · Wissensbasis) → Zuletzt → status list (the strip as rows).

**States**: skeleton rows while loading; each widget fails independently with a small Callout and [Erneut versuchen]; the page never goes blank.

### 6.2 `/assistant` (the core)

URL contract (keep): `/assistant?session=<id>` opens that session (push notifications and Telegram already use it). `/assistant?new=1[&cwd=<path>]` opens the New-Session sheet (folder preselected). `/assistant?new=1&handoff=1` additionally reads `sessionStorage["cm-assistant-handoff"]` (`{ prompt: string, title?: string }`) once, removes it, and prefills the composer of the session that gets started (Builder/Library „Im Assistent ausführen"). Without a param, desktop opens the last session (`storedSessionId()`), mobile shows the list.

#### 6.2.1 Desktop component tree (≥1280)

```
AssistantPage
├─ SessionPane (276px, bg-surface, border-r)
│  ├─ PaneHeader (48): "Sessions" · count · [+ Neu  N]
│  ├─ SegmentedControl filter: Alle | Aktiv n | Wartet n
│  ├─ search Input (sm, optional, filters by title/folder)
│  └─ SessionList (links; J/K; groups: Aktiv · Heute · Diese Woche · Älter)
│     └─ SessionRow (≥56px)
│        line 1: StatusIcon · title (truncate) · relative time
│        line 2: folder name · agent label (German) | "Loop 4/10" | "via Telegram" | error reason (danger)
│        line 3 (when pending): Badge warning "1 Freigabe offen" / "Frage offen"
│        trailing ⋯ DropdownMenu, always visible on touch and on focus/hover:
│          Stoppen (while active), Löschen → confirm()   (no rename: there is no API for it)
├─ ThreadPane (flex)
│  ├─ ThreadHeader (48): title + StatusBadge · line 2 mono cwd · agent · model
│  │   actions: [■ Stoppen] (danger-outline, while active; tooltip "⌘.") · [PanelRight] (<1280) · ⋯
│  ├─ RunBar (only while a run exists; bg-surface, sticky)
│  │   kind icon · "Loop · Iteration 4/10" | "Orchester · 3/5 Teilaufgaben" | "Läuft · 0:42"
│  │   · SegmentedProgress (loop) · "Ende bei DONE" · elapsed
│  │   overlay: "Verbindung unterbrochen – wird wiederhergestellt …" / "Wieder verbunden" (2s)
│  ├─ Thread (scroll; content max-w-[760px] mx-auto)
│  │   IterationDivider · UserPrompt · AssistantMessage · ToolGroup · ThinkingRow
│  │   KnowledgeNote · ApprovalCard · QuestionCard · PlanCard · SubtaskSection · RunEndNote
│  ├─ PendingTray (sticky above composer when a pending card is scrolled out of view)
│  ├─ NewActivityPill ("Neue Aktivität ↓" or warning "Freigabe nötig ↓")
│  └─ Composer
└─ Inspector (300px, bg-surface, Tabs)
   ├─ Lauf
   ├─ Orchester (only for orchestrate runs): <OrchestraLiveList compact />
   ├─ Dateien (n)
   └─ Dev-Server
```

#### 6.2.2 Mobile

- **List screen** (`/assistant`): shell AppBar "Assistent" (+ activity chip, search) with an extra [+] action (New-Session sheet). Filter SegmentedControl (Alle · Aktiv · Wartet), session rows ≥56px, TabBar visible, GateBanner when pending. Empty: EmptyState (§6.2.12).
- **Thread screen** (`?session=<id>`): `useShellChrome({ appBar: false, tabBar: false })`; custom `AppBar`:
  back (`ChevronLeft`, "Sessions", → `/assistant`) · title + line 2 (StatusBadge inline · agent · model, truncated) · [■] stop (40px, danger-outline, only while active) · ⋯ (Details → inspector bottom sheet; Dev-Server; Dateien; Löschen).
  Below: RunBar (merged with the reconnect overlay; no separate banner), thread at `text-[15px]/6`, then **either** the Composer **or** the StickyActionBar (§6.2.7).
- Approval and question cards render full width in the thread. Diffs wrap by default; "Vollbild" opens the DiffView in a full-height sheet.

#### 6.2.3 New Session (Sheet; right on desktop, bottom on mobile)

Replaces the inline form. Fields in order:
1. **Projektordner**: recent folders as chips first, then the existing FolderBrowser (keep: parent navigation, "Neuer Ordner", the confirmation line „Session startet in: X").
2. **Agent**: SegmentedControl Claude Code / Gemini CLI / … (all providers the current form supports), each with a one-line capability note below ("Dateien ändern ✓ · Freigabe & Sandbox ✓" / "Dateien ändern ✓ · ohne Freigabe-Gate").
3. **Modell** (optional): Input or ModelPicker with "Standard" preselected (keep the free-text model field behaviour).
4. **Berechtigungen** as RadioCards:
   - "Nur lesen" (Read, Grep, Glob): "Liest und sucht, ändert nichts."
   - **"Bearbeiten mit Freigabe"** (empfohlen, default for Claude Code): Read, Grep, Glob, Edit, Write, Bash; approval "all"; sandbox on. "Jede Änderung und jeder Befehl wartet auf deine Freigabe."
   - "Volle Autonomie" (`tone="danger"`): same tools, approval off. Danger Callout „Der Agent ändert Dateien und führt Befehle ohne Rückfrage aus." plus a required Checkbox „Ich weiß, dass Befehle ohne Rückfrage laufen."
   - Capabilities come from the existing capability sets (today: approval gate for Claude Code and pi, sandbox for Claude Code only). Presets an agent cannot honour are disabled with the reason, e.g. „Freigabe-Gate nur mit Claude Code oder pi." / „Sandbox nur mit Claude Code."
5. **Erweitert** (collapsed disclosure): tool ToggleChips (`aria-pressed`), approval mode SimpleSelect, Sandbox SwitchRow, permission mode SimpleSelect with German labels (`PERMISSION_MODE_LABEL`, §8.3). If Edit/Write/Bash are on without a gate, a warning Callout appears inline.
6. **Sticky footer**: summary line („CodeMaestro · Claude Code · Bearbeiten mit Freigabe") and **Session starten** (primary, `lg`). The last used settings are remembered per device (`localStorage["cm-new-session"]`).

#### 6.2.4 Thread rendering

- **AssistantMessage**: Markdown (GFM: headings, lists, tables, links, inline code, fenced code with a copy button) via `react-markdown` + `remark-gfm`; raw HTML is never rendered. No bubble; a ProviderMark avatar line only at the start of an assistant segment. No syntax highlighting in v1.
- **UserPrompt**: `bg-surface-2 rounded-lg p-3`, full reading width, preserves whitespace. Loop prompts tagged „Loop-Prompt · wird jede Iteration gesendet".
- **ToolGroup**: consecutive `tool_use`/`tool_result` rows fold into one 40px row: `› 4 Aktionen · Lesen ×2 · Suchen · Befehl  [1 Fehler]  6,2 s` (duration only when known).
  - Expanded rows: tool icon · German verb (`TOOL_LABEL`) · mono target (path, pattern or command, truncated) · status (✓ / ✕ / spinner while running).
  - Each row expands to input/output (max 12 lines + „Mehr anzeigen"). A failed command row auto-expands with the tail of its output; the group starts expanded when it contains an error.
- **ThinkingRow**: collapsed „Überlegt …" row, expandable.
- **IterationDivider**: „Iteration 3 von 10 · Kontext fortgesetzt" (time only when known); past iterations collapsible.
- **SubtaskSection** (orchestrate): header with `RoleChip` + model label + subtask title + state, collapsible body. Review rounds nest under their subtask: „Reviewer prüft · Runde 1/2" (`review_start`/`review_text`, collapsible) ending in a verdict Badge („passt" success / „Änderungen nötig" warning); the author's fix round follows as „Korrektur nach Runde 1" (`subtask_text` with `fixRound`). „Zusammenfassung" (synthesis) comes last. Workers are never shown as raw IDs (use `workerLabel` / `roleName`).
- **KnowledgeNote**: „Wissensbasis genutzt · 3 Quellen" → Popover with the sources; keep „nichts verlässt den Server".
- **RunEndNote**: „Abgeschlossen · 12:04" (cost only when > 0) or an error Callout with the message and [Erneut ausführen] (re-sends the last prompt) [Details].
- **Auto-scroll**: follow new output only while the user is within 80px of the bottom; otherwise show the NewActivityPill and leave the position alone. `behavior: "auto"` under reduced motion.
- Colours from tokens only.

#### 6.2.5 Composer

- AttachmentChips (name · size · progress · ×) above the field.
- Textarea autosize 1–8 rows. Placeholder by state: „Nachricht an den Agenten …" / „Nachricht an den laufenden Agenten …" / „Hinweis für die nächste Iteration einreihen …" (loop running).
- Toolbar: **ModeChip** (DropdownMenu/Popover; `Direkt` | `Orchester · <preset>` | `Loop · 10× · DONE`) · ToggleChip **Wissen** · Paperclip IconButton („Datei anhängen") · hint „⌘↵ senden" (desktop only) · Send IconButton (primary, 40 mobile / 32 desktop; „Senden", or „Einreihen" while a run accepts queued input).
- **Loop popover** (ModeChip → Loop → „Einstellungen"):

  | Field | Control | Default |
  |---|---|---|
  | Max. Iterationen | number Input with stepper, 1–100 | 10 |
  | Abschlusssignal | Input (mono) | `DONE` |
  | Pause zwischen Iterationen | SimpleSelect with the existing interval list: keine / 1 min / 5 min / 10 min / 30 min / 1 h | keine |
  | Kontext | SegmentedControl: Fortsetzen / Frisch je Iteration | Fortsetzen |
  | Bei Fehler stoppen | SwitchRow | an |

  Footer text: „Der Prompt wird wiederholt gesendet, bis die Antwort ‚DONE' enthält oder das Maximum erreicht ist."
- **Orchester popover** (ModeChip → Orchester): active Besetzung (`presetLabel`), enabled roles as `RoleChip`s, Dirigent model (SimpleSelect of workers with „Automatisch (laut Orchester)" first = the existing planner choice), SwitchRow „Plan vor Ausführung freigeben" (on = the existing hybrid flow: plan → PlanCard → run; off = direct orchestrate; remembered per device), optional „Projektkontext" (the former Wizard fields: Stack, Vorgaben, routing preference, „Ergebnis prüfen lassen"), link „Besetzung bearbeiten →" (`/orchestra`).

#### 6.2.6 ApprovalCard

`Card variant="warning"`, `role="region"` with `aria-labelledby` its title, focusable (`tabIndex={0}`); `A` / `D` / `H` work while it has focus.

- **Header** (warning-subtle): `ShieldAlert` · title by kind · tool Badge · `Countdown variant="ring"` „läuft ab in 4:32".

  | Kind (detection) | Title | Body |
  |---|---|---|
  | Edit (`tool` Edit/MultiEdit) | Datei bearbeiten? | path · +n −m · DiffView |
  | Write, `overwrites === false` | Neue Datei anlegen? | path · Badge success „neue Datei" · DiffView (all +) |
  | Write, `overwrites === true` | Datei schreiben? | warning Callout „**Überschreibt eine bestehende Datei** (128 Zeilen). Inhalt, der hier fehlt, geht verloren." (line count = equal + del lines of the diff) · DiffView |
  | Bash | Befehl ausführen? | CommandBlock (cwd, sandbox line) · risk Badges (danger) from client heuristics: „Löscht Dateien" (`rm -r`, `rm -f`), „sudo", „Netzwerkzugriff" (`curl`, `wget`, `ssh`, `scp`), „Außerhalb des Projektordners" (absolute paths outside cwd, `..`), „Schreibt in .git" |
  | Bash starting with `git push` | Nach GitHub pushen? | CommandBlock; when `/api/github` reports `connected: false`: warning Callout „GitHub ist nicht verbunden – der Push wird fehlschlagen." [Jetzt verbinden] → `/settings?section=github` |

- **Footer**: [✓ Freigeben `A`] primary · [Ablehnen `D`] outline · [Mit Hinweis ablehnen] ghost; right-aligned note „Ohne Entscheidung wird nach Ablauf abgelehnt." On mobile the footer is hidden; the StickyActionBar carries the actions.
- **Mit Hinweis**: expands a Textarea (autofocus) „Was soll der Agent anders machen?" with preset ToggleChips („Kleinere Schritte", „Erst fragen", „Nur Tests ändern") that insert text, then [Ablehnen & Hinweis senden].
- **States**: pending; <60s → Countdown danger „Läuft gleich ab"; submitting → buttons `aria-busy`; resolved → one-line receipt „✓ Freigegeben · 14:06" / „✕ Abgelehnt: ‚…'" / „Über Telegram entschieden"; expired → neutral row „Abgelaufen – automatisch abgelehnt".
- **Several gates**: cards stack in arrival order; no „Alle freigeben". „Alle ablehnen" lives in the thread ⋯ menu behind `confirm()`.
- **Persistence**: pending cards come from the run snapshot's `pending[]` and the stream; ending a stream must not drop unresolved cards.

#### 6.2.7 QuestionCard, PlanCard, StickyActionBar

- **QuestionCard**: info header „Frage vom Agenten". Per question: header + text, options as a `RadioGroup` (single) or Checkbox group („Mehrfachauswahl möglich"), 40px rows with description; last option „Eigene Antwort …" (free text). [Antworten] stays disabled with the reason „Noch 1 Frage offen" until every question is answered. Keep the existing answer payload format.
- **PlanCard** (ExitPlanMode `kind: "plan"` and orchestrator plans):
  - ExitPlanMode: Markdown plan; actions [Plan freigeben] (primary) · [Überarbeiten …] (deny with hint) · [Ablehnen].
  - Orchestrator plan (hybrid flow): numbered subtasks; each row = title · `RoleChip` · model (SimpleSelect/ModelPicker of workers, file-capable filter when `editsFiles`, with the same capability error as the org chart: „Kann keine Dateien ändern") · depends-on note. Actions [Plan ausführen] · [Abbrechen].
- **StickyActionBar** (mobile thread screen, replaces the composer while the active session has ≥1 pending item; `pb-safe`, `shadow-lg`, `bg-popover`):
  - Line 1: kind icon + target („helpers.ts schreiben") · „1 von 3" with prev/next chevrons when several · Countdown text.
  - Line 2 (approval): [Ablehnen] outline · [Hinweis] outline (opens a bottom sheet with the hint textarea and presets) · [Freigeben] primary; `xl` (48px), widths 1 : 1 : 1.4, Freigeben on the right under the thumb.
  - Question: [Antworten] (disabled with „Noch 1 offen"). Plan: [Überarbeiten] · [Plan freigeben].
  - Tapping line 1 scrolls the card into view. Calls `useBottomChrome` with its height.
- **PendingTray** (desktop): sticky strip above the composer when a pending card is out of view: „⚠ Freigabe: helpers.ts schreiben · läuft ab in 4:32  [Ansehen]".

#### 6.2.8 Inspector

- **Lauf**: definition list: Status (StatusBadge) · Gestartet („14:02 · in der App" / „via Telegram") · Laufzeit · Agent · Modell · Freigaben (German approval mode) · Sandbox (an/aus) · Kosten (only when > 0). Loop section: settings as Badges (max. 10 · Ende: DONE · Kontext fortgesetzt · Stopp bei Fehler) and a vertical **IterationTimeline** (✓ done / current in state colour / ✕ failed / ◌ ausstehend collapsed as „5–10 ausstehend"; duration and summary only when known), [Nach dieser Iteration anhalten] only if the API supports it, else omitted.
- **Orchester**: `OrchestraLiveList compact` (§6.3.8), plus „Besetzung ansehen" → `/orchestra`.
- **Dateien (n)**: files touched in this session, derived from Edit/Write tool calls (path, M for edits / A for new files, count of edits). Tap → scroll to the last tool row for that file.
- **Dev-Server** (moved out of the thread header): detected suggestion („pnpm dev · Port 3000 erkannt"), command and port inputs, [Starten] / [Stoppen], status, URL (tailnet HTTPS) with copy and open, log tail (mono, ScrollArea). Keep every existing dev-server behaviour.
- Below 1280px the inspector is a right Sheet; on mobile a bottom Sheet from ⋯ → „Details".

#### 6.2.9 Run bar and connection

The run bar is the only place for reconnect state (no toast): „Verbindung unterbrochen – wird wiederhergestellt … (Versuch 2)"; on recovery „Wieder verbunden" for 2s. If the client stops polling (budget exhausted), the state is `unknown` with [Erneut prüfen] (re-fetches the session and re-attaches); never „Bereit".

#### 6.2.10 Upload

Paperclip → file input; chips show progress; failures show the reason inline on the chip. Keep the existing upload API and behaviour.

#### 6.2.11 Dialogs

Delete session: `confirm({ title: "Session löschen?", description: "Verlauf und Anhänge werden entfernt. Laufende Läufe werden gestoppt. Dateien im Projektordner bleiben unverändert.", confirmLabel: "Löschen", tone: "danger" })`. Stop a loop or orchestrate run: `confirm({ title: "Lauf stoppen?", description: "Die aktuelle Iteration wird abgebrochen. Bereits geänderte Dateien bleiben." })`. Single turns stop without a dialog.

#### 6.2.12 States

| State | Treatment |
|---|---|
| Loading | Skeleton rows (list), 3 skeleton blocks (thread) |
| No sessions | EmptyState: „Noch keine Session" · „Starte einen Agenten in einem Projektordner." · [Neue Session] · „Tipp: N" (desktop) |
| None selected (desktop) | „Wähle eine Session oder starte eine neue." + the 3 most recent sessions + [Neue Session]. Never "links". |
| New empty thread | Prompt suggestion chips: „Projekt erklären", „Tests ausführen und Fehler beheben", „README verbessern", „Aus Bibliothek einfügen …" |
| Error | Danger Callout in the thread with message, [Erneut ausführen] [Details] |
| Offline overlay | Banner across the pane; composer disabled with „Offline – Nachricht wird nicht gesendet" |

### 6.3 `/orchestra`: the "Orchester" org chart

The user's explicit wish: „den Orchestrator vernünftig einstellen können, wie ein interaktives Organigramm, welches Modell welche Rolle haben soll".

**Mental model**: the **Dirigent** (plans the subtasks and writes the summary) leads the roles, arranged in three columns: **Planen → Umsetzen → Prüfen**. Each role has a model (or **Automatisch**), a capability („darf Dateien ändern"), a description the Dirigent uses to pick it, instructions, and optionally a **Prüfschleife** (another role reviews its output).

The columns are a **derived view**, not stored data (the backend has no section field):
- **Prüfen**: the role is the reviewer of at least one enabled role's enabled Prüfschleife.
- **Umsetzen**: otherwise, `editsFiles === true`.
- **Planen**: everything else (read-only roles).

So "moving" a role means changing what it does: switching „darf Dateien ändern" moves it between Planen and Umsetzen; making it the reviewer of a Prüfschleife moves it to Prüfen. Order inside a column follows the order of `config.roles`. Icons are derived from the role id/name (`architekt` Compass, `coder` Code, `reviewer` ScanEye, `tester` FlaskConical, `recherche` Search, `doku` FileText, `sicherheit` Shield, `frontend` Palette, `datenbank` Database, otherwise UserRound).

#### 6.3.1 Data contract (backend task #7, already implemented)

Source of truth: `src/lib/assistant/orchestra-types.ts` (client-safe; the UI imports its types and helpers directly) and `src/lib/validation/schemas.ts`. Summary:

```ts
interface OrchestraRole {
  id: string;            // slug, ROLE_ID_PATTERN, unique; create with slugifyRoleId(name, takenIds)
  name: string;          // non-empty, ≤ ORCHESTRA_LIMITS.name
  description: string;   // shown on the card; offered to the planner ("Einsetzen bei …")
  instructions: string;  // prepended to every subtask this role runs
  workerId: string;      // "" = Automatisch
  editsFiles: boolean;   // "darf Dateien ändern"
  enabled: boolean;
  reviewLoop: { enabled: boolean; reviewerRoleId: string; maxRounds: number }; // 1..3, on the reviewed role
}
interface OrchestraConfig {
  version: 1;
  conductor: { workerId: string; instructions: string }; // "" = Automatisch
  roles: OrchestraRole[];                                 // ≤ ORCHESTRA_LIMITS.roles (12)
  preset: "quality" | "balanced" | "local" | "custom";
}
interface OrchestraWorkerInfo { id: string; kind: string; label: string; editsFiles: boolean;
  local?: boolean; model?: string; strengths?: string }
```

| Method | Path | Body → response |
|---|---|---|
| GET | `/api/orchestra` | → `{ config, presets: ["quality","balanced","local"] }` (defaults when nothing is saved) |
| PUT | `/api/orchestra` | `{ config }` → `{ config }`; 400 `{ error }` (German) on schema failure |
| POST | `/api/orchestra/preset` | `{ preset, clientProviders, config? }` → `{ config, warnings: string[] }`, computed from the workers available now, **not saved** |
| POST | `/api/assistant/orchestrate/workers` | `{ clientProviders }` → `{ workers: OrchestraWorkerInfo[] }` |

`clientProviders` is built the same way the assistant builds it today (API keys and base URLs from the client key store, `@/lib/ai/client-keys`).

Client-safe helpers the UI reuses (never re-implement them): `defaultOrchestraConfig`, `slugifyRoleId`, `resolveConductor`, `resolveRoleWorker` (tells whether an assignment is Auto or unavailable and which worker Auto would pick), `reviewerFor`, `clampRounds`, `validateOrchestra` (German warning strings), `ORCHESTRA_LIMITS`, `isLocalWorker`, `workerTier`, `bestFileWorker`.

Live events (published into the session run, see `OrchEvent` in `src/lib/assistant/orchestrator.ts`):

| Event | Fields the UI uses |
|---|---|
| `plan` | `subtasks[]` (`id, title, workerId, dependsOn, editsFiles, roleId?`), `roles[]` (`id, name, editsFiles`) |
| `subtask_start` / `subtask_end` | `subtaskId, title, workerId, workerLabel, roleId?, roleName?` |
| `subtask_text` | `subtaskId, content, fixRound?` (fix round after a review) |
| `review_start` / `review_text` / `review_end` | `subtaskId, round, reviewerRoleId?, reviewerRoleName?, reviewerLabel?, verdict? ("pass" \| "changes" \| "unknown")` |
| `synthesis`, `error`, `run_end` | as today |

When `roleId` is absent (role-less plans), the UI maps by `workerId` (first enabled role with that worker) and otherwise shows „Dirigent wählte <workerLabel>".

#### 6.3.2 Presets

The server computes presets (`buildPreset`) from the workers available right now; the UI shows the result and its `warnings`, and the user saves.

| Preset (UI label) | What it does |
|---|---|
| **Qualität** | The strongest available model everywhere (Claude Code > Gemini CLI > Cloud-API > lokal). |
| **Ausgewogen** | Strongest model for Dirigent, Architekt and Reviewer; the other roles on a cheaper file-capable worker below the top tier (Gemini CLI, a local agent) where one exists. |
| **Lokal & günstig** | Local models only: text models for read-only roles, file-capable local workers (e.g. pi + Ollama) for roles that change files; Auto with a warning where nothing fits. |
| **Eigene Besetzung** | `preset === "custom"`: anything edited by hand. |

- Applying a preset calls `POST /api/orchestra/preset` with the current config (roles and instructions are kept, only models change). The returned warnings appear in a dismissible warning Callout under the toolbar.
- Applying over unsaved changes asks first: `confirm({ title: "Besetzung ‚Qualität' laden?", description: "Deine ungespeicherten Modell-Zuweisungen werden ersetzt." })`.
- Any manual change sets `preset` to `"custom"`. Until the next save the SegmentedControl shows the preset it came from with a modified dot („Ausgewogen ●") and the note „geändert: Tester, Doku" (client-side memory only).

#### 6.3.3 Desktop anatomy (≥1024)

See `docs/design/mockup-A-desktop-orchestra.png` (the mockup's plan-approval switch, „Parallel" stepper and „Ersatzmodell" are not in the backend and are dropped).

- **Page header** (48): „Orchester" · „Welches Modell spielt welche Rolle?" · problems Badge (warning „2 Hinweise" / danger „1 Problem", jumps to the first) · [Verwerfen] (ghost, only with changes) · [Speichern `⌘S`] (primary; `disabledReason` „Keine Änderungen" or „Erst 1 Problem beheben").
- **Toolbar**: preset SegmentedControl (Qualität · Ausgewogen · Lokal & günstig; none selected for „custom", with the „Eigene Besetzung" note) · modification note · **Live banner** when an orchestrate run is active (from `useActivity`): „Live · ‚Auth-Refactor' · Coder arbeitet an Teilaufgabe 3/5 · [Ansehen]"; several runs: „2 Läufe live ▾".
- **Model palette** (256px, bg-surface): filter Input, then groups „Agenten · dürfen Dateien ändern" (`editsFiles`) / „Nur Text · lokal" (`local && !editsFiles`) / „Nur Text · Cloud-API" (rest). Each **ModelChip**: grip · ProviderMark · label · tier hint („stark" for `workerTier` 3, „frei per Login" for Gemini CLI, „lokal" for local, „API" for cloud) · usage count („2×"). `strengths` shows in a Tooltip. Footer hint „Auf eine Rolle ziehen – oder Modell wählen und Enter → ‚Zuweisen an …'" and a link „Weitere Modelle in Einstellungen → Provider". [Neu prüfen] re-fetches workers.
- **Canvas** (`canvas-grid`, scrolls):
  - **ConductorCard** (420px, `border-primary-border`): baton icon tile · „Dirigent" · „plant, verteilt an Rollen, fasst zusammen" · live state Badge · model slot (Auto shows „Automatisch · <resolved label>" from `resolveConductor`) · instruction preview (one line, or „Keine Zusatz-Anweisung").
  - **Connectors**: CSS lines only: vertical from the Dirigent to a horizontal bus, short drops to the 3 column pills. Grid `grid-cols-3 gap-x-10`; no measuring. Live: the drop to the working column is `bg-primary`.
  - **Column**: pill (icon, name, count) · RoleCards (`gap-3`) · dashed „+ Rolle" button (the new role's defaults put it in that column: Planen → read-only, Umsetzen → `editsFiles`, Prüfen → read-only and offered as reviewer of the first Umsetzen role without one).
  - **RoleCard** (`Card`, ≈250px): header (icon tile, name, state Badge, ⋯ menu) · **model slot** (36px button, `border-border-strong`, ProviderMark + label; Auto → dashed „Automatisch · <resolved label>", „Modell hierher ziehen oder tippen" while dragging) · footer line (capability icon + „nur lesen" / „darf Dateien ändern" + description preview, or the review line „↻ Reviewer prüft · max. 2 Runden" / „↻ prüft Coder"). Disabled roles (`enabled: false`) render at 60% opacity with a neutral Badge „aus".
  - **Review link**: dashed arrow in the gap between the reviewed card (Umsetzen) and its reviewer (Prüfen); `motion-safe:animate-dash` while a review round runs. Links that are not between neighbouring columns fall back to the card's text line.
  - Footnote: „Änderungen gelten ab dem nächsten Lauf."
- **Inspector** (300px):
  - Nothing selected: **Prüfung** – the list of problems with fix actions (§6.3.7); empty: „Alles in Ordnung."
  - Role selected: SwitchRow „Rolle aktiv" · Name (Input) · **Modell** (ModelPicker with „Automatisch", inline problem and fix buttons) · **Darf** SwitchRow „Dateien ändern" („Edit/Write im Projektordner. Nur Agenten wie Claude Code, Gemini CLI oder pi können das.") · **Beschreibung** (Textarea 2 rows, „Wofür der Dirigent diese Rolle einsetzt") · **Anweisung** (Textarea) · **Prüfschleife** (SwitchRow „Von einer anderen Rolle prüfen lassen" + reviewer SimpleSelect (other enabled roles) + „Max. Runden" SegmentedControl 1/2/3) · [Rolle entfernen] (danger-ghost).
  - Dirigent selected: Modell (with „Automatisch" and the resolved label) · Anweisung („Zusatz-Anweisung für Planung und Zusammenfassung") · a short „Wie der Dirigent plant" explanation („Er zerlegt die Aufgabe in Teilaufgaben, wählt für jede eine passende Rolle anhand ihrer Beschreibung und fasst die Ergebnisse am Ende zusammen.").

#### 6.3.4 Mobile anatomy (<768)

See `docs/design/mockup-A-mobile-orchestra.png` and `-orchestra-sheet.png`.

- `useShellChrome({ appBar: false })`; own AppBar: „Orchester" · problems Badge · [Speichern] (primary, sm). TabBar stays visible.
- Horizontally scrollable preset SegmentedControl; compact Live banner.
- Dirigent card (model row with chevron → model sheet).
- Columns as grouped lists along a left rail (the org-chart spine). Rows ≥56px: name + state Badge, model line (ProviderMark · label, or „Automatisch · <label>", or warning reason), chevron.
- **Tap the model line** → bottom Sheet „Modell für ‚Tester'" (ModelPicker sheet): hint „Tester darf Dateien ändern – nur passende Modelle werden angezeigt", „Automatisch" first, then a radio list (56px rows: label, one-line `strengths` or tier, ProviderMark), „5 Modelle nur mit Text ausgeblendet · trotzdem zeigen", footer [Abbrechen] [Zuweisen].
- **Tap the rest of the row** → role editor as a full-height Sheet with the inspector's fields.
- „+ Rolle hinzufügen" closes the list.

#### 6.3.5 Assigning and reassigning (every path has a non-drag alternative, WCAG 2.5.7)

1. **Slot activation (all pointers, keyboard, screen readers; the primary path)**: click/tap/Enter on a model slot → ModelPicker (Popover on desktop, Sheet on mobile), filtered by capability, „Automatisch" always offered.
2. **Drag (desktop, mouse and pen only)**: pointer events with `setPointerCapture` on palette chips and slot chips; hit-test `[data-drop-target]`. Touch never starts a drag (it fights scrolling).
   - Ghost: popover-style chip, `shadow-md`, offset 12px from the cursor so it never covers the target label.
   - Valid target hover: dashed primary outline + „Loslassen zum Zuweisen".
   - Invalid target (text-only model onto a role with `editsFiles`): dashed danger outline + „Kann keine Dateien ändern"; the drop is refused (the ModelPicker's „trotzdem zeigen" is the deliberate way to do it anyway).
   - Drop replaces the current model; models can serve several roles. Dragging a slot chip back to the palette sets that slot to Automatisch. Esc or dropping elsewhere cancels. The canvas auto-scrolls near its edges.
3. **Palette chip activation (keyboard/click)**: Enter/Space or click opens a DropdownMenu „Zuweisen an …" listing Dirigent and every role; incompatible roles disabled with their reason.
4. Every assignment is announced via `aria-live="polite"` („Claude Code · Sonnet ist jetzt Coder.") and offers a 6s undo toast („Tester: gpt-5-mini → Sonnet · Rückgängig").

#### 6.3.6 Adding, renaming, removing, ordering

- **Add**: „+ Rolle" → Popover of suggestions with sensible defaults (name, `editsFiles`, description, instructions): the six default roles from `DEFAULT_ROLES` that are not present, plus Sicherheit, Frontend, Datenbank and „Eigene Rolle …". The id comes from `slugifyRoleId(name, existingIds)`. The new card appears in rename mode with focus. At `ORCHESTRA_LIMITS.roles` (12) the button is disabled with „Maximal 12 Rollen".
- **Rename**: double-click the name, F2, menu „Umbenennen" or the inspector field. Enter saves, Esc cancels. Empty or duplicate names are rejected inline („Gib der Rolle einen Namen." / „Name schon vergeben"). Renaming never changes the id (plans and review loops reference it).
- **Remove**: menu „Entfernen" → removed immediately with a 6s undo toast („Rolle ‚Doku' entfernt · Rückgängig"). Review loops that pointed to it are switched off (and restored on undo). Nothing is permanent until saved.
- **Deactivate**: menu „Deaktivieren" / „Aktivieren" (keeps the role and its settings; the planner ignores it).
- **Order**: menu „Nach oben" / „Nach unten" (moves within `config.roles`). Drag-reordering is phase 2.
- **Duplicate**: menu „Duplizieren" (name „Coder 2", new slug).
- **Save**: ⌘S. Errors block saving; warnings do not. Unsaved changes are kept as a draft in `sessionStorage["cm-orchestra-draft"]` (restored with the toast „Ungespeicherte Änderungen wiederhergestellt" and [Verwerfen]) and `beforeunload` warns when closing the tab.

#### 6.3.7 Problems (live; counted in the header badge, listed in the inspector, inline on cards)

The UI derives structured problems (`{ severity, roleId?, message, fixes[] }`) with the client-safe helpers. Only what the PUT schema would reject is an **error** and blocks saving; everything else matches the backend's rule that nothing blocks a run (unavailable assignments fall back to Auto).

| Rule | Severity | Message | Fixes |
|---|---|---|---|
| Empty name | Error | „Gib der Rolle einen Namen." | inline |
| Duplicate name (UI rule for clarity) | Error | „Name schon vergeben." | inline |
| More than 12 roles | Error | „Maximal 12 Rollen." | — |
| `editsFiles` but the assigned worker cannot edit | Warning (shown in danger colour on the card) | „‚Tester' soll Dateien ändern, aber gpt-5-mini liefert nur Text." | [<bestFileWorker> nehmen] · [Nur lesen lassen] |
| `editsFiles`, Auto, and no file-capable worker exists | Warning | „Kein Modell mit Dateizugriff verfügbar – ‚Tester' liefert nur Text." | [Nur lesen lassen] |
| Assigned worker not available | Warning | „Modell ‚<id>' ist nicht verfügbar – Automatisch wird verwendet." | [Automatisch] · [Modell wählen] |
| Prüfschleife points to a missing role / itself / a disabled role | Warning | „Die Prüfschleife zeigt auf eine Rolle, die es nicht gibt." / „‚Coder' kann sich nicht selbst prüfen." / „Reviewer ‚Reviewer' ist deaktiviert – die Prüfschleife wird übersprungen." | [Prüfschleife ausschalten] · [Reviewer aktivieren] |
| No enabled role | Warning | „Keine Rolle aktiv – der Dirigent verteilt Teilaufgaben direkt an Modelle." | [Rolle hinzufügen] |
| No workers at all | Warning | `NO_MODEL_WARNING` | [Zu den Providern] |
| Role on Automatisch | Info (no badge count) | „Automatisch – gewählt wird beim Start: <resolved label>." | — |
| Reviewer uses the same worker as the reviewed role | Info | „Reviewer und Coder nutzen dasselbe Modell – eine zweite Meinung prüft wirksamer." | [<other vendor> nehmen] |

Visuals: a capability mismatch shows the model slot with a danger border and `PenOff` icon plus the message under it (as in the mockup); other warnings put a warning dot on the card. On mobile the summary collapses into the AppBar badge.

#### 6.3.8 Live view

Shown on `/orchestra` (Live banner → highlights on the chart) and as `OrchestraLiveList` in the assistant inspector and the mobile Details sheet.

| Who | States |
|---|---|
| Dirigent | plant … (run started, no `plan` yet) · verteilt n Teilaufgaben (`plan`) · koordiniert (subtasks running) · fasst zusammen … (`synthesis`) · Plan wartet auf Freigabe (hybrid flow before `/orchestrate/run`) |
| Role | wartet (neutral; „wartet auf Coder" from `dependsOn`) · **arbeitet · 0:42** (Card `live`: primary tint + sweep bar, current subtask title, „1 von 2") · Korrektur nach Runde n (`subtask_text` with `fixRound`) · fertig (success, „2/2") · Fehler (danger) · Automatisch („Dirigent wählte qwen2.5-coder") |
| Reviewer | prüft · Runde 1/2 (`review_start`; the review link animates) · „passt" (success, `verdict: pass`) · „Änderungen nötig" (warning, `verdict: changes`) |

The connector from the Dirigent to the working column is drawn in primary (static under reduced motion). Tapping a role in the live list scrolls the thread to that role's SubtaskSection (assistant) or opens the session (orchestra page).

#### 6.3.9 States

- Loading: skeleton Dirigent + 3 skeleton columns; palette „prüfe Modelle …".
- No workers: EmptyState „Kein Modell verfügbar. Richte Claude Code, Gemini CLI, Ollama oder einen API-Key ein." [Zu den Providern] (`/settings?section=providers`).
- Config API failing: danger Callout with the error and [Erneut versuchen]; editing disabled (never fake a save).
- Save error: toast with the server's German message and [Erneut versuchen]; the draft stays.

#### 6.3.10 Why no `@xyflow/react`

- The structure is a fixed two-level tree (1 + 3 columns + ≤12 roles) with at most a few review links; there is nothing to route or lay out freely.
- A pan/zoom canvas fights page scrolling and pinch-zoom on phones and has tiny targets.
- Its node keyboard accessibility is generic and would have to be rebuilt.
- ~50 KB gzip plus a stylesheet.
- A CSS-grid tree reflows to the mobile list, gives native focus order and a DOM order screen readers read correctly.
- Pointer-event DnD is ~150 lines and covers mouse and pen. Revisit only if free-form role graphs become a requirement.

### 6.4 `/settings`

**Routing**: `/settings?section=<id>`; ids: `general`, `notifications`, `providers`, `models`, `pi`, `orchestra`, `github`, `telegram`, `app`. Default `general` on desktop.

- **Desktop**: section nav column (220px, sticky) with status hints: Allgemein · Benachrichtigungen (an/aus) · Provider (`4/13`) · Standardmodell · Lokale Agenten (pi) (status dot) · Orchester (↗) · GitHub (status dot) · Telegram (`aktiv`) · App & Updates (version). Content max 720px.
- **Mobile**: an index list (rows ≥48px with the same hints) → section detail with an AppBar back button (`useShellChrome({ appBar: false })` + `AppBar`).

| Section | Content |
|---|---|
| Allgemein | Design: `ThemeSegmented` (System / Dunkel / Hell). Sprache: „Deutsch" (read-only text). |
| Benachrichtigungen | SwitchRow „Push auf diesem Gerät" with honest state text: „Aktiv" · „Nicht unterstützt – auf dem iPhone erst ‚Zum Home-Bildschirm' hinzufügen" · „Im Browser blockiert – in den Website-Einstellungen erlauben" · „Benötigt HTTPS (z. B. tailscale serve)". [Test senden] (existing `/api/push/test`). Categories only if the backend supports them (it does not today: omit). Copy: „Benachrichtigungen führen direkt zur Freigabe. Entscheiden kannst du nur in der App – mit Blick auf den Diff." |
| Provider | Summary „4 von 13 eingerichtet" + filter SegmentedControl (Eingerichtet / Alle). Configured providers = expanded cards; others = compact rows with [Einrichten] (expands inline). Keep: API-Key vs Login segmented control, „Verbindung testen", SecretInput with reveal, env-var hints, „Key holen" links, „lokal" / „Key optional" Badges, free-text model entry. Buttons: **Speichern** and **Prüfen** (never "Save"/"Validate"). |
| Standardmodell | Active provider and default model (existing settings-store), with a ModelPicker or SimpleSelect. |
| Lokale Agenten (pi) | The existing `PiSettings` content (install hint, model list with capability badges, refresh), restyled: capability badges become `Badge` variants (Tools ✓ success / nur Text neutral / Thinking brand / Vision info / small context warning). Keep every behaviour. |
| Orchester | `OrchestraSummaryCard variant="settings"` + [Organigramm öffnen] → `/orchestra`. |
| GitHub | §6.4.1 |
| Telegram | Keep the status pill („aktiv · @bot") and copy („Die PWA bleibt primär … Kein Zwang"). Replace the "type `-` to delete" convention with an explicit [Token entfernen] (danger-ghost) behind `confirm()` that sends the same delete value the API expects. Permission/approval/provider selects use the German label maps (§8.3). |
| App & Updates | Version (from `package.json`), service-worker status („aktiv" / „Update wartet" / „nicht registriert"), [Nach Updates suchen] (`registration.update()`; the update toast comes from `PwaRegister`), install hint („Zum Home-Bildschirm hinzufügen für Vollbild und Push"; `beforeinstallprompt` button when available, iOS instructions otherwise). |

#### 6.4.1 GitHub section (the user's sandbox/push problem)

Info Callout „Warum ein Token?": „Die Sandbox sperrt SSH-Schlüssel und Schlüsselbund. CodeMaestro gibt Git stattdessen ein Token über HTTPS – verschlüsselt auf deinem Server gespeichert."

**GitHub-Konto card**, mapped to the existing API (`GET/PATCH/DELETE /api/github`, `POST /api/github/device/start`, `POST /api/github/device/poll`, `POST /api/github/token`, `POST /api/github/test`) and `GithubStatus`:

| State (from `GithubStatus` / device poll) | UI |
|---|---|
| Not connected | Explanation „Der Agent arbeitet in einer Sandbox ohne deine Git-Zugangsdaten. Verbinde dein Konto, damit er nach deiner Freigabe pushen und Pull Requests öffnen kann." · [Mit GitHub verbinden] (primary; device flow) · „Stattdessen Token einfügen". If no client id is configured (`envClientId === false` and no `oauthClientId`), the device button shows `disabledReason` „Für die Anmeldung per Code braucht der Server eine GitHub-OAuth-App" with the existing client-id setup, and the token path becomes primary. |
| Device flow running (`pending`, `slow_down`) | Steps 1–3 („Öffne github.com/login/device" · „Gib den Code ein" · „Bestätige ‚CodeMaestro' – diese Seite aktualisiert sich von selbst") · the code in large mono (`text-3xl tracking-[0.18em]`, `aria-label` spelling it out) · [Kopieren] („Kopiert ✓") · „gültig noch 14:21" (Countdown text) · [GitHub öffnen ↗] (mobile: „Code kopieren & GitHub öffnen") · [Abbrechen] · Badge info „Warte auf Bestätigung". |
| `expired` | Danger Callout „Der Code ist abgelaufen." [Neuen Code anfordern] |
| `denied` | Warning Callout „Du hast den Zugriff auf GitHub abgelehnt." [Erneut versuchen] |
| Connected | Avatar, @login, name, Badge success „verbunden", „verbunden seit 7. Okt. · GitHub-Anmeldung / Personal Access Token", token kind, scopes as Badges, expiry and auto-refresh when present, `warnings[]` as warning Callouts · [Verbindung testen] (toast with the result) · [Trennen] (danger-outline, `confirm({ title: "GitHub trennen?", description: "Agenten können danach nicht mehr pushen. Widerrufe den Token zusätzlich auf github.com." })`). |
| `tokenReadable === false` | Danger Callout „Token ungültig oder nicht lesbar (Server-Schlüssel geändert)." [Erneut verbinden] |
| Token paste | `SecretInput` „Personal Access Token" · links „Fein-granularen Token erstellen ↗" / „Klassischen Token erstellen ↗" (existing URLs) · required permissions list (Contents read/write, Pull requests read/write, Metadata read) · [Prüfen & speichern]. |

**Agenten & Git** card (existing options only):
- SwitchRow „Token an Agenten weitergeben" (`injectIntoAssistant`): „Assistent-Läufe können damit pushen und `gh` nutzen."
- SwitchRow „Commits mit deiner GitHub-Identität" (`gitIdentity`): shows the commit email („Commits als …").
- Info line: „Jeder `git push` läuft über die Freigabe der Session – mit ‚Bearbeiten mit Freigabe' siehst du ihn als Freigabe-Karte."

Security line: „Der Token wird verschlüsselt auf deinem Server gespeichert und nur für Git-Operationen genutzt."

### 6.5 `/builder`

- **Stepper** with real states: 1 Projekt · 2 Abschnitte · 3 Vorschau · 4 Verfeinern. Each step: complete ✓, current, invalid (danger dot + reason), locked (disabled with Tooltip „Erst ein Ziel angeben"). `aria-current="step"`.
- **Layout** (desktop): main form (Field with labels, hints, character counts) + right rail 320px:
  - **Technik-Empfehlung** card. Empty: „Beschreibe dein Ziel – wir schlagen passende Techniken vor." plus 3 example chips.
  - **Qualität**: linter score (0–100, ring or bar with number) and issues linking to fields.
  - **Mehrere Agenten (Schwarm)** inside a collapsed „Erweitert" disclosure; „ruflo" moves into the description.
- **Footer** (sticky on mobile): [Zurück] [Weiter: Abschnitte]; on step 1 [Mit KI generieren] (primary) and [Manuell aufbauen].
- **Vorschau** header actions: [Im Assistent ausführen] (primary; writes `sessionStorage["cm-assistant-handoff"] = { prompt, title }` and navigates to `/assistant?new=1&handoff=1`, §6.2) · [Im Playground testen] · [Speichern].
- **Reset**: `confirm({ title: "Alle Eingaben verwerfen?", tone: "danger" })`.
- Dialogs (`save-prompt-dialog`, `load-project-dialog`) become `Dialog` (focus trap, Esc).
- **Mobile**: single column; the rail becomes a „Technik & Qualität" Sheet opened by a button showing the score.
- All labels German (e.g. „Projektinformationen", „Mit KI generieren").

### 6.6 `/library`

- **Desktop**: split view. List (360px: search, tag filter chips, sort SimpleSelect) | detail.
  - Detail Tabs: Inhalt · Versionen (DiffView-style version diff) · Testfälle.
  - Actions: [Im Assistent ausführen] (primary; same handoff as the Builder) · [Im Playground testen] · [Im Builder bearbeiten] · ⋯ (Exportieren, Duplizieren, Löschen → `confirm()`; only actions the API supports).
- **Card**: title, two-line description, `v3`, date, tags (keep).
- **Empty**: „Noch keine Prompts gespeichert." [Prompt bauen] [Aus Vorlage starten].
- **Mobile**: list → detail (the detail pushes with an AppBar back button).

### 6.7 `/templates`

- Category Tabs/chips (keep filters), grid of cards: icon, title, description, tags.
- Primary [Verwenden], ghost [Vorschau] (opens a Sheet).
- Remove the redundant „Built-in" badge; mark only user templates „Eigene".

### 6.8 `/playground`

- Tabs **Einzeln | Vergleich** (replaces the unexplained toggle). Vergleich: „Gleicher Prompt, bis zu 3 Modelle nebeneinander."
- Left: prompt editor (CodeMirror, Field label „Prompt (XML)") and „Test-Eingabe".
- Right: run configuration (model selection per column, „Parameter" Popover) and [Ausführen ⌘↵], with `disabledReason` „Erst einen Prompt eingeben".
- Results: cards with streaming output and metrics (Dauer, Tokens, Kosten when known), [Kopieren] [In Bibliothek speichern].
- Empty: „Ergebnis erscheint hier · ⌘↵ zum Ausführen".
- Mobile: SegmentedControl Prompt / Ergebnis; comparison results as Tabs.

### 6.9 `/knowledge`

- Header: „Wissensbasis" · [Dokument hinzufügen] (Sheet: Datei hochladen / Text einfügen; URL only if the API supports it).
- Status strip: „Embedding: bge-m3 über Ollama · bereit". If unavailable, warning Callout „Ollama nicht erreichbar – die Wissensbasis ist inaktiv." with setup hint.
- List/table: Name · Typ · Abschnitte · Hinzugefügt · ⋯ (Neu indexieren if supported, Löschen → `confirm()`).
- „Suche testen" panel: query → top chunks with score and source.
- Empty: explains what it is („Eigene Doku, Specs und Notizen, die Agenten automatisch heranziehen"), what it needs (Ollama + bge-m3), privacy („nichts verlässt den Server"), [Erstes Dokument hinzufügen].

### 6.10 PWA: offline, updates, install

The service worker (`public/sw.js`) already does network-first HTML, an offline page, versioned caches and `SKIP_WAITING`; it is **not** changed by this redesign.

- **Update toast** (from `PwaRegister`, sonner, `duration: Infinity`, id `sw-update`):
  - Desktop: title „Neue Version verfügbar", description „Neu laden, um sie zu nutzen. Laufende Sessions laufen weiter.", action [Neu laden], cancel [Später].
  - Mobile: same toast, compact, above the bottom chrome.
  - Before reloading, `PwaRegister` dispatches `window.dispatchEvent(new Event("cm:before-update-reload"))`; the assistant listens and saves the composer draft to `sessionStorage["cm-composer-draft:<sessionId>"]`, and restores it on mount.
- **`/offline`** (static, works without JS): centred `WifiOff`, „Keine Verbindung zu CodeMaestro", „Dein Server ist gerade nicht erreichbar. Prüfe Tailscale oder dein Netz. Laufende Sessions arbeiten auf dem Server weiter.", [Erneut versuchen] (auto-retry on the `online` event), plain link „Zur Startseite". Styled with tokens; keep `force-static`.
- **Install hint**: Settings → App & Updates (§6.4).

---

## 7. Accessibility checklist (WCAG 2.2 AA)

- [ ] **Contrast**: text ≥4.5:1 everywhere (including `subtle-foreground` on every surface and semantic text on tinted fills); focus ring ≥3:1; control boundaries (`--input`) ≥3:1. No raw palette colours.
- [ ] **Language**: `<html lang="de">`. English strings only for code, paths and product names.
- [ ] **Labels**: every control through `Field` (wires `htmlFor`, `aria-describedby`, `aria-invalid`). Icon buttons have `aria-label`. No placeholder-only labels.
- [ ] **State**: toggles `aria-pressed`; segmented controls via ToggleGroup (`role="radio"` semantics); switches `role="switch"`; nav `aria-current="page"`; stepper `aria-current="step"`; session rows and role cards are real links/buttons (no `div onClick`).
- [ ] **Keyboard**: all actions reachable by Tab; visible 2px focus ring with offset; lists support arrows/J/K; dialogs, sheets and palette trap focus, close on Esc, restore focus. No hover-only controls (the old session delete button).
- [ ] **Single-key shortcuts** only when no text field has focus, or only while the owning card has focus (2.1.4).
- [ ] **Drag alternative** (2.5.7): every drag has slot-activation and menu paths.
- [ ] **Targets** (2.5.8): ≥24×24 everywhere; 40–44px on mobile; 48px in the sticky action bar.
- [ ] **Live regions**: polite for run-state changes and loop iterations; assertive only for a new gate („Freigabe erforderlich: helpers.ts schreiben") and run errors. No live region on token streams; announce „Antwort fertig" instead. Countdown speaks at 60s and 15s only. Org-chart assignments announced.
- [ ] **Focus management**: a new gate moves focus to its card heading only if the user is not typing; otherwise announce only.
- [ ] **Reduced motion**: decoration behind `motion-safe:`; global reduce rule; no information carried by animation alone.
- [ ] **Colour is never the only cue**: every state has icon + label; diffs have the ± gutter; provider dots sit next to names.
- [ ] **Reflow**: usable at 320px and at 200% zoom without horizontal page scroll (diffs scroll inside their own box or wrap).
- [ ] **Viewport**: `dvh` units; both safe-area insets; inputs 16px on mobile (no iOS zoom).
- [ ] **Dialogs** replace every `window.confirm`/`alert`.

---

## 8. Glossary and German microcopy

### 8.1 Glossary

| Concept | Use | Avoid |
|---|---|---|
| Approval | **Freigabe** (Freigabe erforderlich, Freigeben) | Approval, Gate, Freigabe-Gate in body copy (the honest note „Freigabe-Gate & Sandbox nur für Claude Code" may stay) |
| Run | **Lauf** (Lauf stoppen, Läuft) | Run, Ausführung |
| Planner / conductor | **Dirigent** | Planer, Planner |
| Role assignment | **Besetzung** (presets), **Rolle** | Worker mapping, Routing |
| Model / worker | **Modell** (also „Agent" for CLI agents that edit files) | Worker IDs |
| Review loop | **Prüfschleife** | Review loop |
| Knowledge base | **Wissensbasis**, short chip „Wissen" | RAG, Knowledge |
| Loop | **Loop**, **Iteration**, **Abschlusssignal** | Schleife (mixed) |
| Library / Templates | **Bibliothek** / **Vorlagen** | Library, Templates |
| Session | **Session** | Sitzung |
| Settings | **Einstellungen** | Settings |
| Save / Validate | **Speichern** / **Prüfen** | Save, Validate |

### 8.2 Navigation

| Key | Label |
|---|---|
| `/` | Start |
| `/assistant` | Assistent |
| `/orchestra` | Orchester |
| `/builder` | Builder |
| `/library` | Bibliothek |
| `/templates` | Vorlagen |
| `/playground` | Playground |
| `/knowledge` | Wissensbasis |
| `/settings` | Einstellungen |
| Tab „Prompts" / „Mehr" | Prompts / Mehr |

### 8.3 Label maps (`src/lib/labels.ts`)

| Map | Values |
|---|---|
| `PERMISSION_MODE_LABEL` | `default` Nachfragen · `acceptEdits` Änderungen automatisch annehmen · `plan` Nur planen · `auto` Automatisch · `dontAsk` Nicht nachfragen · `bypassPermissions` Ohne Rückfrage (gefährlich) |
| `APPROVAL_MODE_LABEL` | `off` Aus – direkt ausführen · `edits` Nur Dateiänderungen · `all` Dateiänderungen & Befehle |
| `PROVIDER_LABEL` (assistant agents) | `claude` Claude Code · `gemini` Gemini CLI · `opencode` OpenCode · `codex` Codex CLI · `aider` Aider · `pi` pi (lokal) · unknown → the raw id capitalised |
| `TOOL_LABEL` | Read Lesen · Grep Suchen · Glob Dateien finden · LS Ordner ansehen · Bash Befehl · Edit/MultiEdit Bearbeiten · Write Schreiben · NotebookEdit Notebook bearbeiten · WebSearch Websuche · WebFetch Web abrufen · TodoWrite Aufgaben · Task Unteragent · unknown → raw name |
| `RUN_KIND_LABEL` | `turn` Direkt · `orchestrate` Orchester · `loop` Loop |
| `RUN_ORIGIN_LABEL` | `pwa` in der App · `telegram` via Telegram |
| `LOOP_END_LABEL` | §4.3 |

### 8.4 Key strings

| Context | German |
|---|---|
| Status | Bereit · Läuft · Läuft im Hintergrund · Läuft · via Telegram · Wartet auf Freigabe · Wartet auf Antwort · Plan wartet auf Freigabe · Loop pausiert · weiter um 14:32 · Wird gestoppt … · Gestoppt · Abgeschlossen · Fehler · Verbindung wird wiederhergestellt … · Wieder verbunden · Status unbekannt · Erneut prüfen · Offline – Anzeige kann veraltet sein |
| Activity | 1 läuft · 2 laufen · 1 Freigabe · 3 Freigaben warten · Wartet auf dich · Läuft · Gerade läuft nichts. · Öffnen · Ansehen |
| Approval | Freigabe erforderlich · Datei bearbeiten? · Neue Datei anlegen? · Datei schreiben? · Befehl ausführen? · Nach GitHub pushen? · Überschreibt eine bestehende Datei (n Zeilen). Inhalt, der hier fehlt, geht verloren. · neue Datei · läuft ab in 4:32 · Läuft gleich ab · Freigeben · Ablehnen · Mit Hinweis ablehnen · Was soll der Agent anders machen? · Ablehnen & Hinweis senden · Kleinere Schritte · Erst fragen · Nur Tests ändern · Ohne Entscheidung wird nach Ablauf abgelehnt. · Abgelaufen – automatisch abgelehnt · Freigegeben · 14:06 · Abgelehnt · Über Telegram entschieden · Alle ablehnen |
| Risk flags | Löscht Dateien · sudo · Netzwerkzugriff · Außerhalb des Projektordners · Schreibt in .git |
| Question / plan | Frage vom Agenten · Mehrfachauswahl möglich · Eigene Antwort … · Antworten · Noch 1 Frage offen · Plan freigeben · Überarbeiten … · Plan ausführen |
| Composer | Nachricht an den Agenten … · Nachricht an den laufenden Agenten … · Hinweis für die nächste Iteration einreihen … · ⌘↵ senden · Senden · Einreihen · Direkt · Orchester · Loop · Wissen · Datei anhängen · Neue Aktivität ↓ · Freigabe nötig ↓ |
| Loop | Iteration 4/10 · Iteration 3 von 10 · Ende bei „DONE" · Max. Iterationen · Abschlusssignal · Pause zwischen Iterationen · keine · Kontext · Fortsetzen · Frisch je Iteration · Bei Fehler stoppen · Ziel erreicht nach 6 Iterationen · Maximum erreicht (10 Iterationen) · Fehler in Iteration 4 · ausstehend |
| New session | Neue Session · Projektordner · Session startet in: X · Neuer Ordner · Agent · Modell · Standard · Berechtigungen · Nur lesen · Bearbeiten mit Freigabe · empfohlen · Volle Autonomie · Ich weiß, dass Befehle ohne Rückfrage laufen. · Erweitert · Sandbox · Freigabe-Gate nur mit Claude Code oder pi. · Sandbox nur mit Claude Code. · Session starten |
| Inspector | Lauf · Dateien · Dev-Server · Status · Gestartet · Laufzeit · Kosten · Geänderte Dateien · Starten · Stoppen · Öffnen · Kopiert |
| Orchester | Orchester · Welches Modell spielt welche Rolle? · Dirigent · plant, verteilt an Rollen, fasst zusammen · Planen · Umsetzen · Prüfen · Rolle · + Rolle · Rolle hinzufügen · Rolle aktiv · aus · Automatisch · Modell hierher ziehen oder tippen · Loslassen zum Zuweisen · Kann keine Dateien ändern · Zuweisen an … · Modell für „Tester" · trotzdem zeigen · darf Dateien ändern · nur lesen · Beschreibung · Anweisung · Prüfschleife · Von einer anderen Rolle prüfen lassen · max. 2 Runden · prüft · Runde 1/2 · passt · Änderungen nötig · Korrektur nach Runde 1 · wartet · arbeitet · fertig · Fehler · Rolle ‚Doku' entfernt · Rückgängig · Änderungen gelten ab dem nächsten Lauf. · Erst 1 Problem beheben · Keine Änderungen · Maximal 12 Rollen · Name schon vergeben · Qualität · Ausgewogen · Lokal & günstig · Eigene Besetzung · geändert · Plan vor Ausführung freigeben (composer) |
| Settings / GitHub | Allgemein · Benachrichtigungen · Provider · Standardmodell · App & Updates · Mit GitHub verbinden · Stattdessen Token einfügen · Dein Code · gültig noch 14:21 · GitHub öffnen · Warte auf Bestätigung · verbunden · Verbindung testen · Trennen · Token an Agenten weitergeben · Commits mit deiner GitHub-Identität · Prüfen & speichern · Token entfernen |
| Push | Push auf diesem Gerät · Aktiv · Nicht unterstützt · Im Browser blockiert · Test senden |
| PWA | Neue Version verfügbar · Neu laden, um sie zu nutzen. Laufende Sessions laufen weiter. · Neu laden · Später · Keine Verbindung zu CodeMaestro · Erneut versuchen · Zur Startseite |
| Empty states | Noch keine Session · Wähle eine Session oder starte eine neue. · Noch keine Prompts gespeichert. · Noch keine Dokumente in der Wissensbasis. · Ergebnis erscheint hier · Kein Modell verfügbar. |
| Confirmations | Session löschen? · Lauf stoppen? · GitHub trennen? · Alle Eingaben verwerfen? · Preset ‚Qualität' laden? · Token entfernen? · Prompt löschen? · Dokument löschen? — buttons: Löschen / Stoppen / Trennen / Verwerfen / Laden / Entfernen + Abbrechen |
| Toasts | Gespeichert · Kopiert · Verbindung funktioniert · Verbindung fehlgeschlagen: {Grund} · Wieder verbunden · Ungespeicherte Änderungen wiederhergestellt |

---

## 9. Implementation map

### 9.1 Order

1. **P1 Foundation** (tokens, theme, primitives, run-state model) and **P1b Plumbing** (activity API, shell-chrome store, labels, format, hotkeys, client providers) in parallel.
2. **P2 Shell**, **P4 Orchester**, **P5 Prompt & knowledge pages** in parallel.
3. **P3 Assistant** and **P6 Settings & Home** in parallel (both mount components from P4).

Every package: `npm run typecheck` and `npm run lint` clean, `npm test` green, no files touched outside its ownership list, German copy from §8, all existing behaviour preserved.

### 9.2 Cross-package contracts

| Provider | Contract |
|---|---|
| P1 | `@/components/ui/*` (§3.1), `@/components/theme/*`, `@/hooks/use-media-query`, `@/hooks/use-now`, `@/lib/run-state` (§4.1), `layout.tsx` mounts `ThemeScript`, `ThemeController`, `Toaster`, `ConfirmHost`, `PwaRegister`, `AppShell`. |
| P1b | `GET /api/assistant/activity` + `useActivity()` (§4.4); `gatherClientProviders()` (`@/lib/client-providers`, moved verbatim from `assistant-view.tsx`); `@/stores/ui-store` (`sidebarOpen` persisted, `sidebarPrefs: Record<path, boolean>`, `appBarHidden`, `tabBarHidden`); `useShellChrome({ appBar?: boolean, tabBar?: boolean })` (`@/hooks/use-shell-chrome`, sets on mount, restores on unmount); `useHotkeys(map, opts)` (`@/hooks/use-hotkeys`, ignores editable targets and open modals, supports `g a` sequences); `@/lib/labels` (§8.3); `@/lib/format` (`formatRelative`, `formatDuration`, `formatClock`, `formatCost` returning `null` for 0/unknown, `formatCount`). |
| P4 | `@/components/orchestra` index: `useOrchestraConfig()`, `OrchestraLiveList`, `OrchestraSummaryCard`, `RoleChip`, `roleIcon()`, `presetLabel()`, `reduceOrchestraLive()`, `EMPTY_ORCHESTRA_LIVE`, `OrchestraLiveState` (config types come from `@/lib/assistant/orchestra-types`). |
| P6 | Keeps `export function PushToggle()` (no required props) in `src/components/push-toggle.tsx` for the shell. |
| P3 | Keeps the exports of `src/components/assistant/pi-status.tsx` (`PiModel`, `PiStatus`, `PI_PROVIDER_LABEL`, `fetchPiStatus`, `sortPiModels`, `formatContext`, `SMALL_CONTEXT`, `usePiStatus`, `PiInstallHint`) with unchanged signatures; Settings imports them. Honours the `?new=1&cwd=…&handoff=1` contract and the `cm:before-update-reload` event. |
| P2 | `PwaRegister` dispatches `cm:before-update-reload` before activating a new worker. |

---

## 10. Known gaps and phase 2

- Push rules beyond the session gate (never push to main, branch prefix, draft PRs) need backend support.
- Orchestra: fallback model per role, plan approval and parallelism as part of the saved configuration, persisted column/icon per role (today derived), drag-reordering.
- „Sicherheit" defaults in Settings (default approval preset, sandbox default, approval timeout) need backend support; v1 remembers the last New-Session choice per device.
- Per-iteration summaries and durations for the loop timeline need server timestamps; v1 shows only what the event stream provides.
- Notification categories need backend support.
- Free-form role graphs, syntax highlighting in the thread.
- Removing the orphan `/game` route and the pixi.js dependencies.
- The brand indigo (277) and Telegram info blue (235) are close in hue; they always differ by icon and label. Revisit after real-device testing.
