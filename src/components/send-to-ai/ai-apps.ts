/**
 * „In deiner KI-App öffnen": the prompt goes to the user's own AI app (their
 * subscription, in their browser). It always lands in the clipboard; where
 * the app takes a prompt in the URL it is prefilled as well.
 *
 * Prefill parameters, as researched in October 2026.
 *
 * Documented by the vendor:
 * - Claude Code https://claude.ai/code?prompt=…  starts a Claude Code session
 *   on the web with the prompt prefilled (the user sends it and picks the
 *   repository) — the subscription-friendly way to hand a coding prompt over.
 *
 * The chat apps document none of theirs; these are the URLs that link
 * generators, browser extensions and launcher tools use.
 *
 * Verified (several independent sources up to 2026, behaviour consistent):
 * - ChatGPT    https://chatgpt.com/?q=…  fills the composer (it may also send
 *   right away). OpenAI community threads, link generators, docs sites.
 * - Perplexity https://www.perplexity.ai/search?q=…  runs the query at once.
 *   Long-standing search URL, used by launchers and Drafts actions.
 *
 * Best effort (reported but not confirmed, may change without notice):
 * - Claude     https://claude.ai/new?q=…  stopped auto-sending in October
 *   2025 (anthropics/claude-code#8827). Maintained launchers (e.g. the PopClip
 *   extension, last updated September 2026) still open it to start a chat.
 * - Le Chat    https://chat.mistral.ai/chat?q=…  only third-party usage (the
 *   R package „searcher").
 *
 * No prefill:
 * - Gemini     gemini.google.com has no native URL parameter (only browser
 *   extensions add ?q=), so the app opens and the user pastes.
 *
 * Whatever the URL does, the prompt is in the clipboard as a fallback.
 */

export type AiAppId = "chatgpt" | "claude" | "claude-code" | "gemini" | "lechat" | "perplexity";

export interface AiApp {
  id: AiAppId;
  label: string;
  /** Opened when the prompt cannot go into the URL. */
  homeUrl: string;
  /** Prefill URL: `base` plus `?param=<prompt>`. Absent = no prefill. */
  prefill?: {
    base: string;
    param: string;
    /** false = best effort (see the module comment). */
    verified: boolean;
  };
}

export const AI_APPS: readonly AiApp[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    homeUrl: "https://chatgpt.com/",
    prefill: { base: "https://chatgpt.com/", param: "q", verified: true },
  },
  {
    id: "claude",
    label: "Claude",
    homeUrl: "https://claude.ai/new",
    prefill: { base: "https://claude.ai/new", param: "q", verified: false },
  },
  {
    id: "gemini",
    label: "Gemini",
    homeUrl: "https://gemini.google.com/app",
  },
  {
    id: "claude-code",
    label: "Claude Code (Web)",
    homeUrl: "https://claude.ai/code",
    prefill: { base: "https://claude.ai/code", param: "prompt", verified: true },
  },
  {
    id: "lechat",
    label: "Le Chat",
    homeUrl: "https://chat.mistral.ai/chat",
    prefill: { base: "https://chat.mistral.ai/chat", param: "q", verified: false },
  },
  {
    id: "perplexity",
    label: "Perplexity",
    homeUrl: "https://www.perplexity.ai/",
    prefill: { base: "https://www.perplexity.ai/search", param: "q", verified: true },
  },
];

/**
 * Longest prefill URL we build. The query string travels in the request
 * line, which proxies cap at 8 KB by default (nginx) and which CDN firewalls
 * reject well before browsers would; percent-encoding makes an XML prompt
 * 1.3–1.8× longer. 6000 leaves a margin, so prompts up to roughly 3,500–4,500
 * characters are prefilled and longer ones are pasted.
 */
export const MAX_PREFILL_URL_LENGTH = 6000;

export type NoPrefillReason = "unsupported" | "too-long" | "empty" | "encoding";

export type AppLaunch =
  | { url: string; prefilled: true; verified: boolean }
  | { url: string; prefilled: false; reason: NoPrefillReason };

/** The prefill URL for `prompt`, or null when the app has none or the prompt cannot be encoded. */
export function prefillUrl(app: AiApp, prompt: string): string | null {
  if (!app.prefill) return null;
  try {
    // encodeURIComponent (%20, not +): apps that decode with decodeURIComponent
    // would otherwise show literal plus signs.
    return `${app.prefill.base}?${app.prefill.param}=${encodeURIComponent(prompt)}`;
  } catch {
    // Lone UTF-16 surrogates throw URIError.
    return null;
  }
}

/** Where a click on the app goes: the prefill URL when it fits, else the app's start page. */
export function appLaunch(app: AiApp, prompt: string, maxUrlLength = MAX_PREFILL_URL_LENGTH): AppLaunch {
  const text = prompt.trim();
  const home = (reason: NoPrefillReason): AppLaunch => ({ url: app.homeUrl, prefilled: false, reason });
  if (!app.prefill) return home("unsupported");
  if (!text) return home("empty");
  const url = prefillUrl(app, text);
  if (url === null) return home("encoding");
  if (url.length > maxUrlLength) return home("too-long");
  return { url, prefilled: true, verified: app.prefill.verified };
}

/** True when some app could prefill a prompt of this kind but this one is too long for any. */
export function tooLongForPrefill(prompt: string, maxUrlLength = MAX_PREFILL_URL_LENGTH): boolean {
  const results = AI_APPS.filter((a) => a.prefill).map((a) => appLaunch(a, prompt, maxUrlLength));
  return results.length > 0 && results.every((r) => !r.prefilled && r.reason === "too-long");
}

/** Short status under the app's name in the list. */
export function launchHint(launch: AppLaunch): string {
  if (launch.prefilled) return launch.verified ? "Prompt wird eingefügt" : "Prompt wird übergeben, sonst einfügen";
  return launch.reason === "too-long" ? "Zu lang für den Link – einfügen" : "Prompt einfügen";
}

export interface LaunchToast {
  tone: "success" | "info" | "error";
  message: string;
}

/** Feedback after the click, given whether the clipboard copy worked. */
export function launchToast(app: AiApp, launch: AppLaunch, copied: boolean): LaunchToast {
  if (!copied) {
    return launch.prefilled
      ? { tone: "info", message: `Kopieren nicht möglich – der Prompt geht nur per Link an ${app.label}.` }
      : { tone: "error", message: `Kopieren nicht möglich – Prompt bitte selbst kopieren und in ${app.label} einfügen.` };
  }
  if (launch.prefilled && launch.verified) {
    return { tone: "success", message: `Prompt an ${app.label} übergeben – er liegt auch in der Zwischenablage.` };
  }
  if (launch.prefilled) {
    return { tone: "success", message: `Prompt kopiert – falls er nicht schon in ${app.label} steht, dort einfügen.` };
  }
  return { tone: "success", message: `Prompt kopiert – in ${app.label} einfügen` };
}
