"use client";

import * as React from "react";
import { ChevronDown, MessageSquare, Network, Repeat } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl, SegmentedItem } from "@/components/ui/segmented-control";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toggleChipVariants } from "@/components/ui/toggle-chip";
import { useIsMobile } from "@/hooks/use-media-query";
import { loopChipLabel, type ComposerMode, type ProjectContext } from "./composer-logic";
import { LoopSettings } from "./loop-popover";
import { OrchestraModeLabel, OrchestraSettings } from "./orchestra-popover";
import type { LoopOptions } from "./types";

export interface ModeMenuProps {
  mode: ComposerMode;
  onModeChange: (m: ComposerMode) => void;
  loop: LoopOptions;
  onLoopChange: (o: LoopOptions) => void;
  planApproval: boolean;
  onPlanApproval: (v: boolean) => void;
  conductor: string;
  onConductor: (id: string) => void;
  context: ProjectContext;
  onContext: (c: ProjectContext) => void;
  disabled?: boolean;
}

const MODE_ICON = { chat: MessageSquare, orchestrate: Network, loop: Repeat } as const;

const MODE_HINT: Record<ComposerMode, string> = {
  chat: "Eine Aufgabe, ein Agent – die Session antwortet direkt.",
  orchestrate: "Der Dirigent zerlegt die Aufgabe und verteilt sie auf die Rollen des Orchesters.",
  loop: "Die Aufgabe wird wiederholt, bis der Agent das Abschlusssignal ausgibt.",
};

function Panel(p: ModeMenuProps) {
  return (
    <div className="space-y-3">
      <SegmentedControl aria-label="Modus" stretch value={p.mode} onValueChange={(v) => p.onModeChange(v as ComposerMode)}>
        <SegmentedItem value="chat" icon={<MessageSquare />}>
          Direkt
        </SegmentedItem>
        <SegmentedItem value="orchestrate" icon={<Network />}>
          Orchester
        </SegmentedItem>
        <SegmentedItem value="loop" icon={<Repeat />}>
          Loop
        </SegmentedItem>
      </SegmentedControl>
      <p className="text-ui text-muted-foreground">{MODE_HINT[p.mode]}</p>
      {p.mode === "loop" ? <LoopSettings value={p.loop} onChange={p.onLoopChange} /> : null}
      {p.mode === "orchestrate" ? (
        <OrchestraSettings
          planApproval={p.planApproval}
          onPlanApproval={p.onPlanApproval}
          conductor={p.conductor}
          onConductor={p.onConductor}
          context={p.context}
          onContext={p.onContext}
        />
      ) : null}
    </div>
  );
}

/** ModeChip: Direkt | Orchester · <Besetzung> | Loop · 10× · DONE, with the mode's settings. */
export function ModeMenu(props: ModeMenuProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const Icon = MODE_ICON[props.mode];
  const label =
    props.mode === "loop" ? loopChipLabel(props.loop) : props.mode === "orchestrate" ? <OrchestraModeLabel /> : "Direkt";
  const chip = (
    <button
      type="button"
      disabled={props.disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(toggleChipVariants({ variant: props.mode === "chat" ? "default" : "brand", size: "sm" }), "h-10 max-w-[60vw] md:h-7 md:max-w-xs")}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <Icon aria-hidden />
      <span className="sr-only">Modus: </span>
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown aria-hidden className="size-3.5 opacity-70" />
    </button>
  );

  if (isMobile) {
    return (
      <>
        {chip}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle>Modus</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <Panel {...props} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{chip}</PopoverTrigger>
      <PopoverContent side="top" align="start" aria-label="Modus" className="max-h-[min(70dvh,40rem)] w-[22rem] overflow-y-auto">
        <Panel {...props} />
      </PopoverContent>
    </Popover>
  );
}
