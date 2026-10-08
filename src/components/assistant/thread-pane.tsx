"use client";

import * as React from "react";
import type { OrchestraLiveState } from "@/components/orchestra";
import { useShellChrome } from "@/hooks/use-shell-chrome";
import { formatClock } from "@/lib/format";
import { Composer, type ComposerProps } from "./composer";
import { GateProvider } from "./gate-context";
import type { InspectorTab } from "./inspector";
import { RunBar } from "./run-bar";
import { stateAnnouncement, type GateReceipt, type LiveState, type PendingCard } from "./run-events";
import { HintSheet, StickyActionBar } from "./sticky-action-bar";
import { Thread } from "./thread";
import { ThreadAppBar, ThreadHeader } from "./thread-header";
import type { ThreadBlock } from "./thread-model";
import type { ActiveRunState } from "./use-run-state";
import type { ConnectionInfo } from "./use-session-run";
import type { ApprovalEvent, Decide, SessionInfo } from "./types";
import { approvalKind } from "./risk-flags";

export interface ThreadPaneProps {
  variant: "desktop" | "mobile";
  sessionId: string;
  title: string;
  info: SessionInfo | null;
  run: ActiveRunState;
  live: LiveState;
  running: boolean;
  stopping: boolean;
  connection: ConnectionInfo;
  blocks: ThreadBlock[];
  pending: PendingCard[];
  receipts: GateReceipt[];
  orch: OrchestraLiveState;
  loopSignal?: string;
  planning: boolean;
  /** The hybrid plan editor (rendered at the end of the thread). */
  planCard?: React.ReactNode;
  now: number;
  composer: ComposerProps;
  decide: Decide;
  onStop: () => void;
  onDenyAll: () => void;
  onDelete: () => void;
  onInspector?: (tab: InspectorTab) => void;
  listCollapsed?: boolean;
  onExpandList?: () => void;
  onRetry: () => void;
  onRecheck: () => void;
}

/** Mobile thread screen: hides the shell's bars (own AppBar, composer or action bar). */
function MobileChrome() {
  useShellChrome({ appBar: false, tabBar: false });
  return null;
}

export function ThreadPane(p: ThreadPaneProps) {
  const mobile = p.variant === "mobile";
  const [hintCard, setHintCard] = React.useState<ApprovalEvent | null>(null);
  const { state, overlay, recovered } = p.run;
  const telegram = p.live.run?.origin === "telegram";
  const needGithub = p.pending.some((c) => approvalKind(c) === "push");
  const stateDetail =
    state === "loop_paused" && p.live.loop?.resumeAt ? `weiter um ${formatClock(p.live.loop.resumeAt)}` : undefined;

  // Polite announcements: run-state changes of this session, loop iterations,
  // „Antwort fertig" (DESIGN.md §7). Opening another session is not a change.
  const [polite, setPolite] = React.useState("");
  const prevState = React.useRef({ sid: p.sessionId, state });
  React.useEffect(() => {
    const before = prevState.current;
    prevState.current = { sid: p.sessionId, state };
    if (before.sid !== p.sessionId) {
      setPolite("");
      return;
    }
    const text = stateAnnouncement(before.state, state);
    if (text) setPolite(text);
  }, [state, p.sessionId]);
  const iteration = p.live.loop?.iteration;
  React.useEffect(() => {
    if (iteration && p.live.loop) setPolite(`Iteration ${iteration} von ${p.live.loop.maxIterations}`);
    // Only when the iteration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iteration]);

  const header = {
    title: p.title,
    info: p.info,
    state,
    stateDetail,
    stopping: p.stopping,
    running: p.running,
    pendingCount: p.pending.length,
    onStop: p.onStop,
    onDenyAll: p.onDenyAll,
    onDelete: p.onDelete,
    onInspector: p.onInspector,
    listCollapsed: p.listCollapsed,
    onExpandList: p.onExpandList,
  };

  const status = p.planning ? "Der Dirigent plant die Teilaufgaben …" : p.running && p.live.items.length === 0 && !p.pending.length ? "Der Agent startet …" : null;

  return (
    <GateProvider decide={p.decide} cwd={p.info?.cwd} sandbox={p.info?.sandbox} needGithub={needGithub} openHint={setHintCard}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mobile ? <MobileChrome /> : null}
        {mobile ? <ThreadAppBar {...header} /> : <ThreadHeader {...header} />}
        <RunBar
          run={p.running ? p.live.run : null}
          state={state}
          overlay={overlay}
          recovered={recovered}
          attempt={p.connection.attempt}
          loop={p.live.loop}
          signal={p.loopSignal}
          orch={p.orch}
          now={p.now}
          planning={p.planning}
          onRecheck={p.onRecheck}
        />
        <Thread
          blocks={p.blocks}
          pending={p.pending}
          receipts={p.receipts}
          orch={p.orch}
          provider={p.info?.provider}
          model={p.info?.model}
          loading={!p.info}
          running={p.running}
          telegram={telegram}
          ended={p.live.ended}
          status={status}
          onRetry={p.onRetry}
          onSuggest={(t) => p.composer.onChange(t)}
          footer={p.planCard}
          now={p.now}
          sessionKey={p.sessionId}
        />
        {mobile && p.pending.length > 0 ? <StickyActionBar cards={p.pending} /> : <Composer {...p.composer} />}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {polite}
        </div>
      </div>
      {mobile ? <HintSheet card={hintCard} onClose={() => setHintCard(null)} /> : null}
    </GateProvider>
  );
}
