"use client";

import * as React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "./cn";

interface FieldContextValue {
  id: string;
  hintId: string;
  errorId: string;
  hasHint: boolean;
  hasError: boolean;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
  setHasHint: (v: boolean) => void;
  setHasError: (v: boolean) => void;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

export function useFieldContext() {
  return React.useContext(FieldContext);
}

/**
 * Wraps one form control with its label, hint and error. Generates the id and
 * wires `htmlFor`, `aria-describedby` (hint + error) and `aria-invalid`.
 * Controls (Input, Textarea, SelectTrigger, Checkbox, Switch, …) pick it up via
 * useFieldControl().
 */
export function Field({
  id,
  invalid = false,
  required = false,
  disabled = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { id?: string; invalid?: boolean; required?: boolean; disabled?: boolean }) {
  const auto = React.useId();
  const controlId = id ?? `field-${auto}`;
  const [hasHint, setHasHint] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);
  const value = React.useMemo<FieldContextValue>(
    () => ({
      id: controlId,
      hintId: `${controlId}-hint`,
      errorId: `${controlId}-error`,
      hasHint,
      hasError,
      invalid: invalid || hasError,
      required,
      disabled,
      setHasHint,
      setHasError,
    }),
    [controlId, hasHint, hasError, invalid, required, disabled],
  );
  return (
    <FieldContext.Provider value={value}>
      <div data-slot="field" data-invalid={value.invalid || undefined} className={cn("grid gap-1.5", className)} {...props}>
        {children}
      </div>
    </FieldContext.Provider>
  );
}

export function FieldLabel({
  className,
  children,
  optional,
  ...props
}: React.ComponentProps<"label"> & {
  /** Shows a muted "optional" marker, e.g. "optional". */
  optional?: React.ReactNode;
}) {
  const ctx = useFieldContext();
  return (
    <label
      data-slot="field-label"
      htmlFor={props.htmlFor ?? ctx?.id}
      className={cn("text-sm font-medium text-foreground md:text-ui", ctx?.disabled && "opacity-50", className)}
      {...props}
    >
      {children}
      {ctx?.required ? (
        <span aria-hidden className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
      {optional ? <span className="ml-1.5 font-normal text-subtle-foreground">{optional}</span> : null}
    </label>
  );
}

export function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  const ctx = useFieldContext();
  const setHasHint = ctx?.setHasHint;
  React.useEffect(() => {
    if (!setHasHint) return;
    setHasHint(true);
    return () => setHasHint(false);
  }, [setHasHint]);
  return <p data-slot="field-hint" id={ctx?.hintId} className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

/** Renders nothing without children, so `<FieldError>{error}</FieldError>` is safe. */
export function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  const ctx = useFieldContext();
  const setHasError = ctx?.setHasError;
  const show = children != null && children !== false && children !== "";
  React.useEffect(() => {
    if (!setHasError || !show) return;
    setHasError(true);
    return () => setHasError(false);
  }, [setHasError, show]);
  if (!show) return null;
  return (
    <p
      data-slot="field-error"
      id={ctx?.errorId}
      className={cn("flex items-start gap-1 text-xs text-danger", className)}
      {...props}
    >
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

interface ControlA11yProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-required"?: React.AriaAttributes["aria-required"];
  disabled?: boolean;
  required?: boolean;
}

/**
 * Merge a control's own props with the surrounding Field: id, describedby
 * (hint + error + own), aria-invalid and aria-required. Own props win.
 */
export function useFieldControl<P extends ControlA11yProps>(props: P): P & {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
} {
  const ctx = useFieldContext();
  if (!ctx) return props;
  const describedBy =
    [props["aria-describedby"], ctx.hasHint && ctx.hintId, ctx.hasError && ctx.errorId].filter(Boolean).join(" ") ||
    undefined;
  return {
    ...props,
    id: props.id ?? ctx.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (ctx.invalid ? true : undefined),
    "aria-required": props["aria-required"] ?? (ctx.required ? true : undefined),
    disabled: props.disabled ?? (ctx.disabled || undefined),
  };
}
