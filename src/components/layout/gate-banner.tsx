"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useActivity } from "@/hooks/use-activity";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { useBottomChrome } from "@/components/ui/toaster";
import { cn } from "@/components/ui/cn";
import { describePending, pendingTitle } from "./activity-format";
import { sessionHref } from "./activity";
import { useShellOverlays } from "./shell-state";

/**
 * Mobile-only warning bar directly above the TabBar while any gate is open
 * (DESIGN.md §5.4, B graft). One gate links straight to its session; several
 * open the Activity sheet. Rendered only on tab-root screens (TabBar visible).
 */
export function GateBanner({ visible }: { visible: boolean }) {
  const { pending } = useActivity();
  const setActivity = useShellOverlays((s) => s.setActivity);
  const ref = React.useRef<HTMLDivElement>(null);
  const show = visible && pending.length > 0;
  useBottomChrome(ref, show);

  // Polite announcement when the set of open gates grows; the bar itself is
  // not a live region (its countdown ticks every second).
  const first = pending[0];
  const announcement = !show
    ? ""
    : pending.length === 1
      ? `Freigabe nötig: ${pendingTitle(describePending(first))} in ${first.sessionTitle}`
      : `${pending.length} Freigaben warten`;

  return (
    <>
      <span className="sr-only md:hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {show ? (
        <div
          ref={ref}
          role="region"
          aria-label="Offene Freigaben"
          className={cn(
            "relative z-[35] flex h-12 shrink-0 items-center gap-2 border-t border-warning-border pl-4 pr-1.5 md:hidden",
            // Tint over an opaque base so the warning text keeps its contrast.
            "bg-card bg-linear-to-r from-warning-subtle to-warning-subtle text-warning",
          )}
        >
          <ShieldAlert aria-hidden className="size-4 shrink-0" />
          {pending.length === 1 ? (
            <>
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-ui">
                <span className="shrink-0 font-semibold">Freigabe nötig</span>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate text-foreground">{first.sessionTitle}</span>
                {first.expiresAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <Countdown expiresAt={first.expiresAt} label="" className="shrink-0" />
                  </>
                ) : null}
              </p>
              <Button asChild variant="outline" size="md" className="shrink-0">
                <Link href={sessionHref(first.sessionId)}>Öffnen</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 truncate text-ui font-semibold">{pending.length} Freigaben warten</p>
              <Button variant="outline" size="md" className="shrink-0" aria-haspopup="dialog" onClick={() => setActivity(true)}>
                Ansehen
              </Button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
