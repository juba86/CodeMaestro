import type * as React from "react";
import { cn } from "./cn";

export type ProviderTone = "claude" | "gemini" | "local" | "api";

const LOCAL = new Set(["ollama", "pi", "lmstudio", "lm-studio", "local", "llamacpp", "llama.cpp", "vllm"]);

/**
 * Colour family for a provider id or worker kind:
 * claude / claude-cli → claude, gemini / gemini-cli → gemini,
 * ollama / pi / lmstudio / local → local, everything else → api.
 * Accepts prefixed ids such as "claude-cli:opus" or "ollama/qwen3".
 */
export function providerTone(kindOrProviderId: string | null | undefined): ProviderTone {
  const raw = (kindOrProviderId ?? "").trim().toLowerCase();
  const head = raw.split(/[:/]/)[0] ?? "";
  if (head === "claude" || head === "claude-cli" || head === "claude-code") return "claude";
  if (head === "gemini" || head === "gemini-cli") return "gemini";
  if (LOCAL.has(head)) return "local";
  return "api";
}

const DOT: Record<ProviderTone, string> = {
  claude: "bg-prov-claude",
  gemini: "bg-prov-gemini",
  local: "bg-prov-local",
  api: "bg-prov-api",
};

export type ProviderMarkProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Tone directly, or a provider id / worker kind to derive it from. */
  tone?: ProviderTone;
  provider?: string;
  /** Main text, e.g. "Claude Code". The dot is decorative and always sits next to a label. */
  label?: React.ReactNode;
  /** Muted secondary text, e.g. the model "Sonnet". */
  sublabel?: React.ReactNode;
};

/** 8px provider dot + label. */
export function ProviderMark({ tone, provider, label, sublabel, className, ...props }: ProviderMarkProps) {
  const t = tone ?? providerTone(provider);
  return (
    <span data-slot="provider-mark" data-tone={t} className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[t])} />
      {label != null ? <span className="min-w-0 truncate">{label}</span> : null}
      {sublabel != null ? <span className="min-w-0 truncate text-muted-foreground">{sublabel}</span> : null}
    </span>
  );
}

export function ProviderDot({ tone, className }: { tone: ProviderTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], className)} />;
}
