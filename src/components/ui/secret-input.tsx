"use client";

import * as React from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./button";
import { useCopy } from "./copy-text";
import { InputGroup, type InputGroupProps } from "./input";

export type SecretInputProps = Omit<InputGroupProps, "type" | "trailing"> & {
  /** Show a copy button for the current value. */
  copyable?: boolean;
  revealLabel?: string;
  copyLabel?: string;
};

/** Password-style input for API keys and tokens with a reveal toggle (aria-pressed) and optional copy. */
export function SecretInput({
  copyable = false,
  revealLabel = "Wert anzeigen",
  copyLabel = "Kopieren",
  className,
  value,
  defaultValue,
  ref,
  ...props
}: SecretInputProps) {
  const [revealed, setRevealed] = React.useState(false);
  const { copied, copy } = useCopy();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el;
    },
    [ref],
  );

  const currentValue = () => (value != null ? String(value) : (inputRef.current?.value ?? ""));

  return (
    <>
      <InputGroup
        ref={setRef}
        type={revealed ? "text" : "password"}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        value={value}
        defaultValue={defaultValue}
        className={cn("font-mono", copyable ? "pr-20 md:pr-16" : "pr-11 md:pr-9", className)}
        trailing={
          <>
            <IconButton
              aria-label={revealLabel}
              aria-pressed={revealed}
              size="icon-sm"
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </IconButton>
            {copyable ? (
              <IconButton aria-label={copied ? "Kopiert" : copyLabel} size="icon-sm" onClick={() => void copy(currentValue())}>
                {copied ? <Check className="text-success" /> : <Copy />}
              </IconButton>
            ) : null}
          </>
        }
        {...props}
      />
      {copyable ? (
        <span className="sr-only" aria-live="polite">
          {copied ? "Kopiert" : ""}
        </span>
      ) : null}
    </>
  );
}
