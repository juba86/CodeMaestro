"use client";

// „An KI senden": the finished prompt goes straight to an AI instead of the
// Code Assistant. Two ways, one sheet:
// - Per API: streamed here in CodeMaestro with the keys and models the
//   playground uses (stored on this device), with follow-up questions.
// - In deiner KI-App: the user's own ChatGPT/Claude/Gemini/… in a new tab,
//   prompt copied and, where the app allows it, prefilled (see ai-apps.ts).

import * as React from "react";
import Link from "next/link";
import { Check, Copy, Cpu, ExternalLink, FlaskConical, RotateCcw, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";
import { getApiKey, getBaseUrl } from "@/lib/ai/client-keys";
import { getProvider } from "@/lib/ai/catalog";
import type { ProviderName } from "@/lib/ai/types";
import { uid } from "@/lib/uid";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { CodeBlock } from "@/components/ui/code-block";
import { copyText, useCopy } from "@/components/ui/copy-text";
import { Field, FieldLabel } from "@/components/ui/field";
import { ProviderMark } from "@/components/ui/provider-mark";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useIsApple } from "@/components/layout/use-client-info";
import { Markdown } from "@/components/assistant/markdown";
import { ModelSelect } from "@/components/playground/model-select";
import { streamChat } from "@/components/playground/chat-stream";
import { AI_APPS, appLaunch, launchHint, launchToast, tooLongForPrefill, type AiApp, type AppLaunch } from "./ai-apps";
import {
  canAskFollowUp,
  chatErrorMessage,
  historyForApi,
  isSettingsError,
  openingPrompt,
  type ChatTurn,
} from "./chat-turns";

type Tab = "api" | "app";
const TAB_STORAGE_KEY = "cm-send-to-ai-tab";
const PROVIDERS_HREF = "/settings?section=providers";

const providerLabel = (p: string) => getProvider(p)?.label ?? p;
const chars = (n: number) => `${n.toLocaleString("de-DE")} Zeichen`;

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === "app" ? "app" : "api";
  } catch {
    return "api";
  }
}

function storeTab(tab: Tab) {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* storage unavailable: the choice is just not remembered */
  }
}

interface Target {
  provider: ProviderName;
  model: string;
}

/**
 * The per-API conversation. Lives next to the button (not in the sheet), so
 * closing the sheet keeps the answers and a running answer keeps streaming.
 */
function useAiChat(onSettled: (outcome: "answer" | "error") => void) {
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const activeModel = useSettingsStore((s) => s.activeModel);
  const [picked, setPicked] = React.useState<Target | null>(null);
  const target: Target = picked ?? { provider: activeProvider, model: activeModel };
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [draft, setDraft] = React.useState("");
  const controller = React.useRef<AbortController | null>(null);
  const running = turns.some((t) => t.role === "assistant" && t.status === "streaming");

  React.useEffect(() => () => controller.current?.abort(), []);

  // Same rule as the playground: back on the default provider, restore its
  // configured (possibly typed) model.
  function changeTarget(next: Target) {
    const model = !next.model && next.provider === activeProvider ? activeModel : next.model;
    setPicked({ provider: next.provider, model });
  }

  async function ask(question: string, opts: { fresh?: boolean } = {}) {
    if (controller.current || !question.trim() || !target.model) return;
    const base = opts.fresh ? [] : turns;
    const history = historyForApi(base);
    const { provider, model } = target;
    const answerId = uid();
    setTurns([
      ...base,
      { id: uid(), role: "user", content: question },
      { id: answerId, role: "assistant", content: "", status: "streaming", provider, model },
    ]);
    const ctrl = new AbortController();
    controller.current = ctrl;
    const patch = (p: Partial<Extract<ChatTurn, { role: "assistant" }>>) =>
      setTurns((ts) => ts.map((t) => (t.id === answerId && t.role === "assistant" ? { ...t, ...p } : t)));
    try {
      // Keys and base URLs as in the playground: stored on this device.
      const [apiKey, baseUrl] = [await getApiKey(provider), getBaseUrl(provider)];
      const { text, error } = await streamChat({
        provider,
        model,
        prompt: question,
        history,
        apiKey,
        baseUrl,
        signal: ctrl.signal,
        onDelta: (content) => patch({ content }),
      });
      patch({
        content: text,
        status: error && !text ? "error" : "done",
        error: error ? chatErrorMessage(error, providerLabel(provider)) : undefined,
        fixInSettings: error ? isSettingsError(error) : undefined,
      });
      // Not after „Neu starten" (which drops the controller).
      if (controller.current === ctrl) onSettled(text ? "answer" : "error");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        patch({ status: "stopped" });
      } else {
        const raw = err instanceof Error ? err.message : "";
        patch({ status: "error", error: chatErrorMessage(raw, providerLabel(provider)), fixInSettings: isSettingsError(raw) });
        if (controller.current === ctrl) onSettled("error");
      }
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  function stop() {
    controller.current?.abort();
  }

  function reset() {
    controller.current?.abort();
    controller.current = null;
    setTurns([]);
    setDraft("");
  }

  return { target, changeTarget, turns, running, draft, setDraft, ask, stop, reset };
}

type AiChat = ReturnType<typeof useAiChat>;

export interface SendToAiButtonProps {
  /** The prompt to send (the builder's XML, a library prompt's content). */
  prompt: string;
  /** Where the playground has this prompt („Im Playground weitertesten"). */
  playgroundHref: string;
  /** Why sending is unavailable (e.g. empty prompt). */
  disabledReason?: string;
  className?: string;
}

/** Outline button „An KI senden" plus its sheet. */
export function SendToAiButton({ prompt, playgroundHref, disabledReason, className }: SendToAiButtonProps) {
  const [open, setOpen] = React.useState(false);
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  // An answer that settles while the sheet is closed gets a toast to reopen it.
  const chat = useAiChat((outcome) => {
    if (openRef.current) return;
    const action = { label: "Anzeigen", onClick: () => setOpen(true) };
    if (outcome === "answer") toast.success("Die Antwort der KI ist da.", { action });
    else toast.error("Senden an die KI fehlgeschlagen.", { action });
  });

  return (
    <>
      <Button
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        disabledReason={disabledReason}
        className={className}
      >
        <Send aria-hidden /> An KI senden
        {chat.running && !open ? <Spinner aria-label="Antwort läuft" className="size-3.5" /> : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SendToAiSheet prompt={prompt} playgroundHref={playgroundHref} chat={chat} />
      </Sheet>
    </>
  );
}

function SendToAiSheet({ prompt, playgroundHref, chat }: { prompt: string; playgroundHref: string; chat: AiChat }) {
  // Mounted only while open (after hydration), so reading storage here is safe.
  const [tab, setTab] = React.useState<Tab>(readTab);

  return (
    <SheetContent side="auto" size="lg">
      <SheetHeader>
        <SheetTitle>An KI senden</SheetTitle>
        <SheetDescription>Per API hier in CodeMaestro – oder in deiner eigenen KI-App mit deinem Abo.</SheetDescription>
      </SheetHeader>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = v === "app" ? "app" : "api";
          setTab(next);
          storeTab(next);
        }}
        className="min-h-0 flex-1"
      >
        <div className="shrink-0 px-4 pb-2">
          <TabsList variant="pill" aria-label="Wie senden?" className="w-full md:w-fit">
            <TabsTrigger value="api" className="flex-1 md:flex-none">
              <Cpu aria-hidden /> Per API
            </TabsTrigger>
            <TabsTrigger value="app" className="flex-1 md:flex-none">
              <ExternalLink aria-hidden /> In deiner KI-App
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="api" className="flex flex-col">
          <ApiPanel prompt={prompt} playgroundHref={playgroundHref} chat={chat} />
        </TabsContent>
        <TabsContent value="app" className="flex flex-col">
          <AppsPanel prompt={prompt} />
        </TabsContent>
      </Tabs>
    </SheetContent>
  );
}

/* ------------------------------------------------------------------------ */
/* Per API                                                                  */
/* ------------------------------------------------------------------------ */

function ApiPanel({ prompt, playgroundHref, chat }: { prompt: string; playgroundHref: string; chat: AiChat }) {
  const { target, changeTarget, turns, running, draft, setDraft, ask, stop, reset } = chat;
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const stick = React.useRef(true);
  const started = turns.length > 0;
  const promptChanged = started && openingPrompt(turns) !== prompt;
  const last = turns[turns.length - 1];

  // Follow the answer while the reader is at the bottom; leave them be when they scrolled up.
  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current && turns.length > 0) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const sendBlocked = !prompt.trim() ? "Erst einen Prompt aufbauen" : !target.model ? "Erst ein Modell wählen" : undefined;
  const followUpBlocked = running
    ? "Erst die Antwort abwarten"
    : !target.model
      ? "Erst ein Modell wählen"
      : !canAskFollowUp(turns)
        ? "Verlauf ist voll – neu starten oder im Playground weitermachen"
        : !draft.trim()
          ? "Erst eine Nachfrage eingeben"
          : undefined;

  // Keyboard users continue in the composer; on touch screens this would pop
  // the keyboard over the streaming answer.
  function focusComposer() {
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    composerRef.current?.focus();
  }

  function sendPrompt(fresh = false) {
    if (sendBlocked) return;
    stick.current = true;
    if (fresh) reset();
    void ask(prompt, { fresh });
    // The composer replaces the „Senden" button on the next render.
    requestAnimationFrame(focusComposer);
  }

  function sendFollowUp() {
    if (followUpBlocked) return;
    stick.current = true;
    const question = draft.trim();
    setDraft("");
    void ask(question);
    focusComposer();
  }

  const announce =
    last?.role !== "assistant"
      ? ""
      : last.status === "streaming"
        ? "Antwort wird erstellt …"
        : last.status === "error"
          ? `Fehler: ${last.error ?? ""}`
          : last.status === "stopped"
            ? "Antwort abgebrochen"
            : "Antwort fertig";

  return (
    <>
      <SheetBody
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="space-y-4 pb-4"
      >
        <div className="space-y-1.5">
          <ModelSelect provider={target.provider} model={target.model} onChange={changeTarget} />
          <p className="text-xs text-muted-foreground">
            Nutzt die API-Schlüssel und Modelle aus den Einstellungen – wie der Playground.{" "}
            <Link href={PROVIDERS_HREF} className="text-primary-text underline underline-offset-4 hover:no-underline">
              Provider einrichten
            </Link>
          </p>
        </div>

        {!started ? (
          <CodeBlock code={prompt} title={`Prompt · ${chars(prompt.length)}`} wrap className="max-h-64" copyLabel="Prompt kopieren" />
        ) : (
          <ol aria-label="Verlauf" aria-busy={running || undefined} className="space-y-4">
            {turns.map((t, i) => (
              <li key={t.id}>
                {t.role === "user" ? (
                  i === 0 ? (
                    <SentPrompt text={t.content} />
                  ) : (
                    <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm md:text-ui">
                      <span className="sr-only">Deine Nachfrage: </span>
                      {t.content}
                    </div>
                  )
                ) : (
                  <AnswerCard turn={t} />
                )}
              </li>
            ))}
          </ol>
        )}

        {promptChanged && !running ? (
          <Callout
            variant="info"
            title="Prompt geändert"
            action={
              <Button
                variant="outline"
                size="lg"
                className="md:h-8 md:text-ui pointer-coarse:h-11"
                onClick={() => sendPrompt(true)}
                disabledReason={sendBlocked}
              >
                <RotateCcw aria-hidden /> Mit aktuellem Prompt neu starten
              </Button>
            }
          >
            Dieser Verlauf gehört zur vorherigen Fassung des Prompts.
          </Callout>
        ) : null}

        {started ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="lg" className="md:h-8 md:text-ui pointer-coarse:h-11" onClick={reset}>
              <RotateCcw aria-hidden /> Neu starten
            </Button>
            <Button variant="ghost" size="lg" className="md:h-8 md:text-ui pointer-coarse:h-11" asChild>
              <Link href={playgroundHref}>
                <FlaskConical aria-hidden /> Im Playground weitertesten
              </Link>
            </Button>
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </SheetBody>

      {!started ? (
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" asChild>
            <Link href={playgroundHref}>
              <FlaskConical aria-hidden /> Im Playground testen
            </Link>
          </Button>
          <Button variant="primary" size="lg" onClick={() => sendPrompt()} disabledReason={sendBlocked}>
            <Send aria-hidden /> Senden
          </Button>
        </div>
      ) : (
        <form
          className="flex shrink-0 items-end gap-2 border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]"
          onSubmit={(e) => {
            e.preventDefault();
            sendFollowUp();
          }}
        >
          <Field className="min-w-0 flex-1">
            <FieldLabel className="sr-only">Nachfrage an die KI</FieldLabel>
            <Textarea
              ref={composerRef}
              autosize={{ min: 1, max: 6 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nachfrage stellen …"
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line; on touch keyboards
                // Enter stays a line break and the button sends.
                if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
                const mod = e.metaKey || e.ctrlKey;
                if (!mod && window.matchMedia?.("(pointer: coarse)").matches) return;
                e.preventDefault();
                sendFollowUp();
              }}
            />
          </Field>
          {running ? (
            <IconButton
              aria-label="Antwort abbrechen"
              variant="outline"
              size="icon-lg"
              onClick={() => {
                stop();
                focusComposer();
              }}
            >
              <Square />
            </IconButton>
          ) : (
            <IconButton type="submit" aria-label="Nachfrage senden" variant="primary" size="icon-lg" disabledReason={followUpBlocked}>
              <Send />
            </IconButton>
          )}
        </form>
      )}
    </>
  );
}

/** The opening prompt, folded: it is usually long XML. */
function SentPrompt({ text }: { text: string }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-ui font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-9 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-subtle-foreground transition-transform group-open:rotate-90">
          ›
        </span>
        Dein Prompt
        <span className="font-normal text-muted-foreground">· {chars(text.length)}</span>
      </summary>
      <div className="px-3 pb-3">
        <CodeBlock code={text} wrap className="max-h-64" copyLabel="Prompt kopieren" />
      </div>
    </details>
  );
}

function AnswerCard({ turn }: { turn: Extract<ChatTurn, { role: "assistant" }> }) {
  const { copied, copy } = useCopy();
  const label = providerLabel(turn.provider);
  const streaming = turn.status === "streaming";
  return (
    <section
      aria-label={`Antwort von ${label} · ${turn.model}`}
      className={cn(
        "min-w-0 rounded-lg border bg-card shadow-xs",
        turn.status === "error" && !turn.content ? "border-danger-border" : streaming ? "border-primary-border" : "border-border",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border py-1 pl-3 pr-1">
        <ProviderMark provider={turn.provider} label={label} sublabel={turn.model} className="text-xs" />
        <div className="flex shrink-0 items-center gap-1">
          {streaming ? (
            <Badge variant="brand" icon={<Spinner className="size-3" />}>
              läuft
            </Badge>
          ) : turn.status === "stopped" ? (
            <Badge variant="neutral">abgebrochen</Badge>
          ) : turn.status === "error" ? (
            <Badge variant="danger">Fehler</Badge>
          ) : null}
          {turn.content && !streaming ? (
            <>
              <IconButton
                aria-label={copied ? "Kopiert" : "Antwort kopieren"}
                size="icon-sm"
                className="size-11 md:size-7 pointer-coarse:size-11"
                onClick={() => void copy(turn.content)}
              >
                {copied ? <Check className="text-success" /> : <Copy />}
              </IconButton>
              <span className="sr-only" aria-live="polite">
                {copied ? "Kopiert" : ""}
              </span>
            </>
          ) : null}
        </div>
      </header>
      <div className="space-y-2 px-3 py-2.5 text-sm md:text-ui">
        {turn.content ? (
          <Markdown text={turn.content} />
        ) : streaming ? (
          <p className="text-muted-foreground">Warte auf Antwort …</p>
        ) : turn.status === "stopped" ? (
          <p className="text-muted-foreground">Abgebrochen, bevor eine Antwort kam.</p>
        ) : null}
        {turn.error ? (
          <p className="text-xs text-danger">
            {turn.error}
            {turn.fixInSettings ? (
              <>
                {" "}
                <Link href={PROVIDERS_HREF} className="font-medium underline underline-offset-4 hover:no-underline">
                  Zu den Einstellungen
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* In deiner KI-App                                                         */
/* ------------------------------------------------------------------------ */

function showLaunchToast(app: AiApp, launch: AppLaunch, copied: boolean, blocked: boolean) {
  const t = launchToast(app, launch, copied);
  if (blocked) {
    // A fresh click on the toast action is allowed to open the tab.
    toast.warning(`Der Browser hat den neuen Tab blockiert. ${t.message}`, {
      action: { label: `${app.label} öffnen`, onClick: () => void window.open(launch.url, "_blank", "noopener,noreferrer") },
    });
    return;
  }
  if (t.tone === "error") toast.error(t.message);
  else if (t.tone === "info") toast.info(t.message);
  else toast.success(t.message);
}

function AppsPanel({ prompt }: { prompt: string }) {
  const isApple = useIsApple();
  const pasteKey = isApple === null ? "Strg+V bzw. ⌘V" : isApple ? "⌘V" : "Strg+V";
  const launches = React.useMemo(() => AI_APPS.map((app) => ({ app, launch: appLaunch(app, prompt) })), [prompt]);
  const tooLong = React.useMemo(() => tooLongForPrefill(prompt), [prompt]);
  const empty = !prompt.trim();

  async function openApp(app: AiApp, launch: AppLaunch) {
    // Copy first: once the new tab has focus, the clipboard refuses writes.
    const copied = await copyText(prompt);
    // No "noopener" feature: with it window.open always returns null and a
    // blocked popup could not be told apart. The opener is cut right away,
    // before the app's page can run.
    const win = window.open(launch.url, "_blank");
    if (win) {
      try {
        win.opener = null;
      } catch {
        /* cross-origin already: nothing to cut */
      }
    }
    showLaunchToast(app, launch, copied, !win);
  }

  return (
    <SheetBody className="space-y-4 pb-4">
      <p className="text-ui text-muted-foreground">
        Öffnet deine KI in einem neuen Tab – mit deinem eigenen Konto und Abo, ohne API-Schlüssel. Der Prompt landet in der
        Zwischenablage; wo die App es zulässt, steht er schon im Eingabefeld.
      </p>
      {tooLong ? (
        <Callout variant="info" title="Langer Prompt">
          Mit {chars(prompt.trim().length)} ist er zu lang für die Übergabe per Link. Er wird kopiert – in der App mit {pasteKey}{" "}
          einfügen.
        </Callout>
      ) : null}
      <ul aria-label="KI-Apps" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {launches.map(({ app, launch }) => (
          <li key={app.id}>
            <Button
              variant="outline"
              size="xl"
              className="h-auto min-h-14 w-full justify-between gap-3 whitespace-normal py-2 text-left md:h-auto md:min-h-12 pointer-coarse:min-h-14"
              onClick={() => void openApp(app, launch)}
              disabledReason={empty ? "Erst einen Prompt aufbauen" : undefined}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="font-medium">{app.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{launchHint(launch)}</span>
              </span>
              <ExternalLink aria-hidden className="text-muted-foreground" />
              <span className="sr-only">(öffnet in neuem Tab)</span>
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-subtle-foreground">
        Die Übergabe per Link klappt bei ChatGPT, Perplexity und Claude Code (dort offiziell unterstützt), bei Claude und Le Chat
        ohne Gewähr; Gemini nimmt keinen Prompt per Link an. Steht nichts im Eingabefeld: mit {pasteKey} einfügen. Perplexity und teils ChatGPT senden den Prompt sofort ab.
      </p>
    </SheetBody>
  );
}
