"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleDashed, LoaderCircle, ShieldAlert, ShieldCheck, Timer, X } from "lucide-react";
import { OrchestraLiveList, type OrchestraLiveState } from "@/components/orchestra";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { ProviderMark } from "@/components/ui/provider-mark";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClock, formatCost, formatDuration } from "@/lib/format";
import { approvalModeLabel, permissionModeLabel, providerLabel, runOriginLabel } from "@/lib/labels";
import { isWaiting, type RunState } from "@/lib/run-state";
import { LOOP_INTERVALS } from "./composer-logic";
import { DevServerPanel, type DevServer } from "./dev-server-panel";
import type { LoopTimeline } from "./thread-model";
import type { TouchedFile } from "./tool-calls";
import type { RunMeta, SessionInfo } from "./types";

export type InspectorTab = "run" | "orchestra" | "files" | "dev";

export interface InspectorProps {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  info: SessionInfo | null;
  state: RunState;
  run: RunMeta | null;
  loop: LoopTimeline | null;
  orch: OrchestraLiveState;
  showOrchestra: boolean;
  files: TouchedFile[];
  onFile: (f: TouchedFile) => void;
  onSelectSubtask: (subtaskId: string) => void;
  dev: DevServer;
  now: number;
  className?: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2 py-1">
      <dt className="text-ui text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-ui text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function IterationTimeline({ loop, state, running }: { loop: LoopTimeline; state: RunState; running: boolean }) {
  const last = loop.iterations[loop.iterations.length - 1];
  const remainingFrom = (last?.iteration ?? 0) + 1;
  const showPending = running && !loop.end && loop.max >= remainingFrom;
  return (
    <ol className="relative space-y-2.5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border" aria-label="Iterationen">
      {loop.iterations.map((it) => {
        const current = it.state === "current" && running;
        const dur = it.startedAt !== undefined && it.endedAt !== undefined ? formatDuration(it.endedAt - it.startedAt) : null;
        let icon: React.ReactNode;
        if (it.state === "failed") icon = <X className="text-danger" />;
        else if (current && isWaiting(state)) icon = <ShieldAlert className="text-warning" />;
        else if (current && state === "loop_paused") icon = <Timer className="text-primary-text" />;
        else if (current) icon = <LoaderCircle className="text-primary-text motion-safe:animate-spin" />;
        else icon = <Check className="text-success" />;
        return (
          <li key={it.iteration} className="relative flex gap-2.5 pl-0" aria-current={current ? "step" : undefined}>
            <span aria-hidden className="relative z-[1] grid size-4 shrink-0 place-items-center rounded-full bg-surface [&_svg]:size-4">
              {icon}
            </span>
            <span className="min-w-0 text-ui">
              <span className={cn("font-medium", current && "text-primary-text")}>Iteration {it.iteration}</span>
              {dur ? <span className="ml-1.5 tabular-nums text-muted-foreground">{dur}</span> : null}
              {current && isWaiting(state) ? <span className="block text-xs text-warning">Wartet auf Freigabe</span> : null}
              {it.state === "failed" ? <span className="block text-xs text-danger">Fehler</span> : null}
            </span>
          </li>
        );
      })}
      {showPending ? (
        <li className="relative flex gap-2.5 text-ui text-muted-foreground">
          <span aria-hidden className="relative z-[1] grid size-4 shrink-0 place-items-center rounded-full bg-surface">
            <CircleDashed className="size-4 text-subtle-foreground" />
          </span>
          {remainingFrom === loop.max ? `${loop.max} ausstehend` : `${remainingFrom}–${loop.max} ausstehend`}
        </li>
      ) : null}
    </ol>
  );
}

function RunTab({ info, state, run, loop, now }: Pick<InspectorProps, "info" | "state" | "run" | "loop" | "now">) {
  const cost = formatCost(info?.totalCostUsd);
  const running = !!run;
  const s = loop?.settings;
  const pause = s?.intervalSec ? LOOP_INTERVALS.find((i) => i.sec === s.intervalSec)?.label : null;
  return (
    <div className="space-y-5">
      <dl>
        <Row label="Status">
          <StatusBadge state={state} />
        </Row>
        {run ? (
          <Row label="Gestartet">
            <span className="tabular-nums">{formatClock(run.startedAt)}</span> · {runOriginLabel(run.origin)}
          </Row>
        ) : null}
        {run && now > run.startedAt ? (
          <Row label="Laufzeit">
            <span className="tabular-nums">{formatDuration(now - run.startedAt)}</span>
          </Row>
        ) : null}
        {info ? (
          <>
            <Row label="Agent">
              <ProviderMark provider={info.provider} label={providerLabel(info.provider)} />
            </Row>
            <Row label="Modell">{info.model || "Standard"}</Row>
            <Row label="Freigaben">{approvalModeLabel(info.approvalMode)}</Row>
            <Row label="Sandbox">
              {info.sandbox ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <ShieldCheck aria-hidden className="size-3.5" />
                  an
                </span>
              ) : (
                "aus"
              )}
            </Row>
            <Row label="Berechtigung">{permissionModeLabel(info.permissionMode)}</Row>
            {cost ? (
              <Row label="Kosten">
                <span className="tabular-nums">{cost}</span>
              </Row>
            ) : null}
          </>
        ) : null}
      </dl>
      {loop ? (
        <section aria-labelledby="inspector-loop" className="space-y-3 border-t border-border pt-4">
          <h2 id="inspector-loop" className="text-ui font-semibold">
            Loop
          </h2>
          {s ? (
            <div className="flex flex-wrap gap-1.5">
              {s.maxIterations ? <Badge variant="outline">max. {s.maxIterations}</Badge> : null}
              {s.completionPromise ? <Badge variant="outline">Ende: {s.completionPromise}</Badge> : null}
              {s.freshContext !== undefined ? <Badge variant="outline">{s.freshContext ? "Kontext frisch" : "Kontext fortgesetzt"}</Badge> : null}
              {s.stopOnError ? <Badge variant="outline">Stopp bei Fehler</Badge> : null}
              {pause ? <Badge variant="outline">Pause {pause}</Badge> : null}
            </div>
          ) : null}
          {loop.iterations.length ? <IterationTimeline loop={loop} state={state} running={running} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function FilesTab({ files, onFile }: Pick<InspectorProps, "files" | "onFile">) {
  if (!files.length) return <p className="text-ui text-muted-foreground">Noch keine Dateien geändert.</p>;
  return (
    <ul className="-mx-1 space-y-0.5" aria-label="Geänderte Dateien">
      {files.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            onClick={() => onFile(f)}
            className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:min-h-8"
            title={f.path}
          >
            <span
              className={cn("w-4 shrink-0 text-center font-mono text-xs font-semibold", f.kind === "A" ? "text-success" : "text-warning")}
              aria-label={f.kind === "A" ? "neu" : "geändert"}
            >
              {f.kind}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.display}</span>
            {f.count > 1 ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">×{f.count}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Inspector (DESIGN.md §6.2.8): Lauf · Orchester · Dateien · Dev-Server. */
export function Inspector(props: InspectorProps) {
  const { tab, onTab, showOrchestra, files, orch, dev, className } = props;
  const value = tab === "orchestra" && !showOrchestra ? "run" : tab;
  return (
    <Tabs value={value} onValueChange={(v) => onTab(v as InspectorTab)} className={cn("min-h-0", className)}>
      <TabsList className="shrink-0 px-4">
        <TabsTrigger value="run">Lauf</TabsTrigger>
        {showOrchestra ? <TabsTrigger value="orchestra">Orchester</TabsTrigger> : null}
        <TabsTrigger value="files" count={files.length || undefined} countLabel={files.length ? `${files.length} Dateien` : undefined}>
          Dateien
        </TabsTrigger>
        <TabsTrigger value="dev">Dev-Server</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <TabsContent value="run">
          <RunTab {...props} />
        </TabsContent>
        {showOrchestra ? (
          <TabsContent value="orchestra" className="space-y-3">
            <OrchestraLiveList live={orch} compact onSelectSubtask={props.onSelectSubtask} />
            <Link href="/orchestra" className="inline-flex items-center gap-1 text-ui font-medium text-primary-text underline-offset-4 hover:underline">
              Besetzung ansehen
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </TabsContent>
        ) : null}
        <TabsContent value="files">
          <FilesTab files={files} onFile={props.onFile} />
        </TabsContent>
        <TabsContent value="dev">
          <DevServerPanel dev={dev} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
