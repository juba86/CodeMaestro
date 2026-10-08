"use client";

import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { cn } from "./cn";
import { useIsMobile } from "@/hooks/use-media-query";
import { Button } from "./button";
import { useFieldControl } from "./field";
import { InputGroup } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { ProviderDot, ProviderMark, type ProviderTone } from "./provider-mark";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

export interface ModelPickerItem {
  id: string;
  label: string;
  /** One line under the label (strengths, tier, …). */
  sublabel?: string;
  /** Group heading, e.g. „Agenten · dürfen Dateien ändern". */
  group: string;
  tone: ProviderTone;
  editsFiles?: boolean;
  /** Shown after the sublabel: a number renders as "$" × n (0 = „keine Kosten"). */
  costTier?: number | string;
  /** Unavailable: shown disabled with this reason. */
  disabledReason?: string;
  /** Listed first with an „empfohlen" hint. */
  recommended?: boolean;
}

export type ModelPickerProps = {
  items: ModelPickerItem[];
  /** Selected id; "" means „Automatisch" when `allowAuto`. */
  value: string | null | undefined;
  onValueChange: (id: string) => void;
  /** Returns a reason to hide an item (e.g. „liefert nur Text"), or null to show it. */
  filter?: (item: ModelPickerItem) => string | null;
  /** Sheet title / list name, e.g. „Modell für ‚Tester'". */
  title: string;
  hint?: React.ReactNode;
  /** Adds „Automatisch" (value "") as the first option. */
  allowAuto?: boolean;
  autoLabel?: string;
  /** Second line for „Automatisch", e.g. the model it resolves to. */
  autoSublabel?: string;
  placeholder?: string;
  /** Text for the hidden-items row; default „n Modelle ausgeblendet". */
  hiddenLabel?: (count: number) => string;
  /**
   * After „trotzdem zeigen", hidden items are listed disabled with their reason.
   * Set this to make them selectable instead (a deliberate override).
   */
  revealedSelectable?: boolean;
  /** Custom trigger element (gets the open handlers via asChild). */
  children?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
  /** Force a presentation; default: Sheet below md, Popover from md. */
  presentation?: "auto" | "popover" | "sheet";
};

export const AUTO_ID = "";
const AUTO_RADIO = "__cm-auto__";

interface Option {
  key: string;
  id: string;
  label: string;
  meta?: string;
  tone: ProviderTone | null;
  disabledReason: string | null;
  isAuto: boolean;
}

interface Group {
  label: string | null;
  options: Option[];
}

function costText(c: ModelPickerItem["costTier"]): string | undefined {
  if (c == null || c === "") return undefined;
  if (typeof c === "number") return c <= 0 ? "keine Kosten" : "$".repeat(Math.min(4, Math.round(c)));
  return c;
}

const metaOf = (item: ModelPickerItem) => [item.sublabel, costText(item.costTier)].filter(Boolean).join(" · ") || undefined;

const defaultHiddenLabel = (n: number) => (n === 1 ? "1 Modell ausgeblendet" : `${n} Modelle ausgeblendet`);

function useModelOptions({
  items,
  value,
  filter,
  allowAuto,
  autoLabel,
  autoSublabel,
  revealed,
  revealedSelectable,
  query,
}: {
  items: ModelPickerItem[];
  value: string | null | undefined;
  filter?: ModelPickerProps["filter"];
  allowAuto: boolean;
  autoLabel: string;
  autoSublabel?: string;
  revealed: boolean;
  revealedSelectable: boolean;
  query: string;
}) {
  return React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (s: string | undefined) => (s ?? "").toLowerCase().includes(q);
    let hidden = 0;
    const recommended: Option[] = [];
    const byGroup = new Map<string, Option[]>();

    for (const item of items) {
      const hideReason = filter ? filter(item) : null;
      const isCurrent = value != null && item.id === value;
      if (hideReason && !revealed && !isCurrent) {
        hidden += 1;
        continue;
      }
      if (q && !matches(item.label) && !matches(item.sublabel) && !matches(item.group)) continue;
      const reason = item.disabledReason ?? (hideReason && !revealedSelectable && !isCurrent ? hideReason : null);
      const opt: Option = {
        key: item.id,
        id: item.id,
        label: item.label,
        meta: hideReason && (revealed || isCurrent) && !reason ? `${hideReason}` : metaOf(item),
        tone: item.tone,
        disabledReason: reason,
        isAuto: false,
      };
      if (item.recommended && !reason) recommended.push(opt);
      else {
        const list = byGroup.get(item.group) ?? [];
        list.push(opt);
        byGroup.set(item.group, list);
      }
    }

    const groups: Group[] = [];
    const top: Option[] = [];
    if (allowAuto && (!q || matches(autoLabel) || matches(autoSublabel))) {
      top.push({
        key: AUTO_RADIO,
        id: AUTO_ID,
        label: autoLabel,
        meta: autoSublabel,
        tone: null,
        disabledReason: null,
        isAuto: true,
      });
    }
    if (top.length) groups.push({ label: null, options: top });
    if (recommended.length) groups.push({ label: "Empfohlen", options: recommended });
    for (const [label, options] of byGroup) groups.push({ label, options });

    const flat = groups.flatMap((g) => g.options);
    return { groups, flat, hidden };
  }, [items, value, filter, allowAuto, autoLabel, autoSublabel, revealed, revealedSelectable, query]);
}

/**
 * Generic model chooser: typeahead listbox in a Popover on desktop, a radio
 * list in a bottom Sheet on mobile. No fetching; the caller passes `items`.
 */
export function ModelPicker(props: ModelPickerProps) {
  const isMobile = useIsMobile();
  const presentation = props.presentation ?? "auto";
  const asSheet = presentation === "sheet" || (presentation === "auto" && isMobile);
  return asSheet ? <ModelPickerSheet {...props} /> : <ModelPickerPopover {...props} />;
}

function useOpenState(open: boolean | undefined, onOpenChange: ((o: boolean) => void) | undefined) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open ?? inner;
  const setOpen = React.useCallback(
    (o: boolean) => {
      if (open === undefined) setInner(o);
      onOpenChange?.(o);
    },
    [open, onOpenChange],
  );
  return [isOpen, setOpen] as const;
}

function ModelPickerTrigger({
  items,
  value,
  allowAuto,
  autoLabel,
  autoSublabel,
  placeholder,
  disabled,
  className,
  ...aria
}: {
  items: ModelPickerItem[];
  value: string | null | undefined;
  allowAuto: boolean;
  autoLabel: string;
  autoSublabel?: string;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const a11y = useFieldControl(aria);
  const selected = value ? items.find((i) => i.id === value) : undefined;
  const isAuto = allowAuto && value === AUTO_ID;
  return (
    <button
      type="button"
      disabled={disabled}
      data-slot="model-picker-trigger"
      className={cn(
        "flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-foreground md:h-8 md:text-ui",
        "hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        isAuto && "border-dashed border-border-strong",
        className,
      )}
      {...a11y}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {selected ? (
          <ProviderMark tone={selected.tone} label={selected.label} />
        ) : isAuto ? (
          <>
            <Sparkles aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
            <span className="truncate">{autoLabel}</span>
            {autoSublabel ? <span className="truncate text-muted-foreground">· {autoSublabel}</span> : null}
          </>
        ) : (
          <span className="truncate text-subtle-foreground">{value ? value : placeholder}</span>
        )}
      </span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
    </button>
  );
}

function HiddenRow({
  count,
  label,
  onReveal,
}: {
  count: number;
  label: (n: number) => string;
  onReveal: () => void;
}) {
  if (count <= 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1 px-3 py-1 text-ui text-subtle-foreground md:py-2 md:text-xs">
      <span>{label(count)} ·</span>
      <button
        type="button"
        onClick={onReveal}
        className="inline-flex min-h-9 items-center rounded-sm px-1 text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:-mx-1 md:min-h-0"
      >
        trotzdem zeigen
      </button>
    </p>
  );
}

/** Polite note after „trotzdem zeigen" (the button that had focus is gone). */
function RevealedNote({ count, revealed, selectable }: { count: number; revealed: boolean; selectable: boolean }) {
  const text = !revealed || count <= 0
    ? ""
    : `${count === 1 ? "1 ausgeblendetes Modell" : `${count} ausgeblendete Modelle`} eingeblendet${selectable ? "" : ", nicht wählbar"}`;
  return (
    <span className="sr-only" aria-live="polite">
      {text}
    </span>
  );
}

function ModelPickerPopover({
  items,
  value,
  onValueChange,
  filter,
  title,
  hint,
  allowAuto = false,
  autoLabel = "Automatisch",
  autoSublabel,
  placeholder = "Modell wählen",
  hiddenLabel = defaultHiddenLabel,
  revealedSelectable = false,
  children,
  open,
  onOpenChange,
  disabled,
  className,
  ...aria
}: ModelPickerProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const [query, setQuery] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const [revealedCount, setRevealedCount] = React.useState(0);
  const [active, setActive] = React.useState<string | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // Each opening (also via a controlled `open`) starts fresh: no search, filter on.
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setQuery("");
      setActive(null);
      setRevealed(false);
    }
  }
  const base = React.useId();
  const listId = `${base}-list`;
  const optionId = (key: string) => `${base}-opt-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const { groups, flat, hidden } = useModelOptions({
    items,
    value,
    filter,
    allowAuto,
    autoLabel,
    autoSublabel,
    revealed,
    revealedSelectable,
    query,
  });
  const enabled = flat.filter((o) => !o.disabledReason);
  const selectedKey = value == null ? null : value === AUTO_ID && allowAuto ? AUTO_RADIO : value;
  // The highlighted option: the user's choice while it is visible, else the selection, else the first.
  const activeKey =
    (active && enabled.some((o) => o.key === active) && active) ||
    (selectedKey && enabled.some((o) => o.key === selectedKey) && selectedKey) ||
    enabled[0]?.key ||
    null;

  const activeDomId = activeKey ? optionId(activeKey) : undefined;

  React.useEffect(() => {
    if (!isOpen || !activeDomId) return;
    document.getElementById(activeDomId)?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeDomId]);

  const choose = (o: Option) => {
    if (o.disabledReason) return;
    onValueChange(o.id);
    setOpen(false);
  };

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const idx = enabled.findIndex((o) => o.key === activeKey);
    const next = idx < 0 ? 0 : (idx + delta + enabled.length) % enabled.length;
    setActive(enabled[next].key);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home" && enabled.length) {
      e.preventDefault();
      setActive(enabled[0].key);
    } else if (e.key === "End" && enabled.length) {
      e.preventDefault();
      setActive(enabled[enabled.length - 1].key);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = enabled.find((x) => x.key === activeKey);
      if (o) choose(o);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children ?? (
          <ModelPickerTrigger
            items={items}
            value={value}
            allowAuto={allowAuto}
            autoLabel={autoLabel}
            autoSublabel={autoSublabel}
            placeholder={placeholder}
            disabled={disabled}
            className={className}
            {...aria}
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-1rem))] flex-col p-0"
        aria-label={title}
      >
        <div className="shrink-0 border-b border-border p-2">
          <InputGroup
            ref={searchRef}
            size="sm"
            leading={<Search />}
            role="combobox"
            aria-label={`${title} – suchen`}
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeDomId}
            placeholder="Modell suchen …"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(null);
            }}
            onKeyDown={onKeyDown}
          />
          {hint ? <p className="px-1 pt-2 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div id={listId} role="listbox" aria-label={title} className="max-h-80 min-h-0 overflow-y-auto p-1">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-muted-foreground">
              {query ? "Kein Modell passt zur Suche." : "Kein Modell verfügbar."}
            </p>
          ) : (
            groups.map((g, gi) => (
              <div key={g.label ?? `top-${gi}`} role="group" aria-labelledby={g.label ? `${base}-g${gi}` : undefined}>
                {g.label ? (
                  <div id={`${base}-g${gi}`} className="px-2 pb-1 pt-2 text-xs font-medium text-subtle-foreground">
                    {g.label}
                  </div>
                ) : null}
                {g.options.map((o) => {
                  const selected = o.key === selectedKey;
                  const isActive = o.key === activeKey;
                  return (
                    <div
                      key={o.key}
                      id={optionId(o.key)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={o.disabledReason ? true : undefined}
                      onMouseMove={() => !o.disabledReason && o.key !== active && setActive(o.key)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cn(
                        "flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-ui",
                        isActive && "bg-accent",
                        o.disabledReason && "cursor-not-allowed",
                      )}
                    >
                      <span className="grid size-4 shrink-0 place-items-center">
                        {selected ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
                      </span>
                      {/* Disabled: dim the name only; the reason stays readable. */}
                      {o.tone ? (
                        <ProviderDot tone={o.tone} className={o.disabledReason ? "opacity-60" : undefined} />
                      ) : (
                        <Sparkles aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("truncate font-medium", o.disabledReason && "opacity-60")}>{o.label}</span>
                        {o.disabledReason || o.meta ? (
                          <span className={cn("truncate text-xs", o.disabledReason ? "text-subtle-foreground" : "text-muted-foreground")}>
                            {o.disabledReason ?? o.meta}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        {hidden > 0 && !revealed ? (
          <div className="shrink-0 border-t border-border">
            <HiddenRow
              count={hidden}
              label={hiddenLabel}
              onReveal={() => {
                setRevealedCount(hidden);
                setRevealed(true);
                searchRef.current?.focus();
              }}
            />
          </div>
        ) : null}
        <RevealedNote count={revealedCount} revealed={revealed} selectable={revealedSelectable} />
      </PopoverContent>
    </Popover>
  );
}

function ModelPickerSheet({
  items,
  value,
  onValueChange,
  filter,
  title,
  hint,
  allowAuto = false,
  autoLabel = "Automatisch",
  autoSublabel,
  placeholder = "Modell wählen",
  hiddenLabel = defaultHiddenLabel,
  revealedSelectable = false,
  children,
  open,
  onOpenChange,
  disabled,
  className,
  ...aria
}: ModelPickerProps) {
  const [isOpen, setOpen] = useOpenState(open, onOpenChange);
  const [query, setQuery] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const [revealedCount, setRevealedCount] = React.useState(0);
  const selectedKey = value == null ? "" : value === AUTO_ID && allowAuto ? AUTO_RADIO : value;
  const [pending, setPending] = React.useState<string>(selectedKey);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const radiosRef = React.useRef<HTMLDivElement | null>(null);
  const base = React.useId();

  // Opening (also via a controlled `open`) starts from the current value,
  // with no search and the filter on.
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setPending(selectedKey);
    else {
      setQuery("");
      setRevealed(false);
    }
  }

  const { groups, flat, hidden } = useModelOptions({
    items,
    value,
    filter,
    allowAuto,
    autoLabel,
    autoSublabel,
    revealed,
    revealedSelectable,
    query,
  });
  const pendingOption = flat.find((o) => o.key === pending && !o.disabledReason);

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetTrigger asChild disabled={disabled}>
        {children ?? (
          <ModelPickerTrigger
            items={items}
            value={value}
            allowAuto={allowAuto}
            autoLabel={autoLabel}
            autoSublabel={autoSublabel}
            placeholder={placeholder}
            disabled={disabled}
            className={className}
            {...aria}
          />
        )}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => {
          // Start on the current choice (the radio group forwards focus to the
          // checked item) instead of the close button; no keyboard pops up.
          if (!radiosRef.current) return;
          e.preventDefault();
          radiosRef.current.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {hint ? <SheetDescription className="text-sm">{hint}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
        </SheetHeader>
        {items.length > 8 ? (
          <div className="px-4 pb-2">
            <InputGroup
              ref={searchRef}
              leading={<Search />}
              aria-label={`${title} – suchen`}
              placeholder="Modell suchen …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}
        <SheetBody className="px-2 py-1">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-muted-foreground">
              {query ? "Kein Modell passt zur Suche." : "Kein Modell verfügbar."}
            </p>
          ) : (
            <RadioGroupPrimitive.Root
              ref={radiosRef}
              aria-label={title}
              value={pending}
              onValueChange={setPending}
              className="flex flex-col gap-1"
            >
              {groups.map((g, gi) => (
                <div
                  key={g.label ?? `top-${gi}`}
                  role="group"
                  aria-labelledby={g.label ? `${base}-g${gi}` : undefined}
                  className="flex flex-col gap-1"
                >
                  {g.label ? (
                    <p id={`${base}-g${gi}`} className="px-3 pb-1 pt-3 text-xs font-medium text-subtle-foreground">
                      {g.label}
                    </p>
                  ) : null}
                  {g.options.map((o) => (
                    <RadioGroupPrimitive.Item
                      key={o.key}
                      value={o.key}
                      disabled={Boolean(o.disabledReason)}
                      className={cn(
                        "group flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                        "data-[state=checked]:bg-primary-subtle data-[state=checked]:ring-1 data-[state=checked]:ring-primary-border",
                        "disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      )}
                    >
                      <span
                        aria-hidden
                        className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-input group-data-[state=checked]:border-primary group-disabled:opacity-50"
                      >
                        <span className="size-2.5 scale-0 rounded-full bg-primary group-data-[state=checked]:scale-100" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-base font-medium group-disabled:opacity-60">{o.label}</span>
                        {o.disabledReason || o.meta ? (
                          <span className={cn("truncate text-sm", o.disabledReason ? "text-subtle-foreground" : "text-muted-foreground")}>
                            {o.disabledReason ?? o.meta}
                          </span>
                        ) : null}
                      </span>
                      {o.tone ? (
                        <ProviderDot tone={o.tone} className="group-disabled:opacity-60" />
                      ) : (
                        <Sparkles aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                      )}
                    </RadioGroupPrimitive.Item>
                  ))}
                </div>
              ))}
            </RadioGroupPrimitive.Root>
          )}
          {hidden > 0 && !revealed ? (
            <HiddenRow
              count={hidden}
              label={hiddenLabel}
              onReveal={() => {
                setRevealedCount(hidden);
                setRevealed(true);
                // The button disappears: continue in the search field or the list
                // (focusing the radio group moves focus to its checked/first item).
                requestAnimationFrame(() => (searchRef.current ?? radiosRef.current)?.focus());
              }}
            />
          ) : null}
          <RevealedNote count={revealedCount} revealed={revealed} selectable={revealedSelectable} />
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline" size="lg">
              Abbrechen
            </Button>
          </SheetClose>
          <Button
            variant="primary"
            size="lg"
            disabledReason={pendingOption ? undefined : "Erst ein Modell wählen"}
            onClick={() => {
              if (!pendingOption) return;
              onValueChange(pendingOption.id);
              setOpen(false);
            }}
          >
            Zuweisen
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
