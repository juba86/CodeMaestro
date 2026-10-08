"use client";

import { useMemo } from "react";
import { CircleCheck, CircleX, ExternalLink, Info, TriangleAlert } from "lucide-react";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { buildXml } from "@/lib/prompt-engine/xml-builder";
import { lintPrompt, type LintIssue, type LintReport, type LintSeverity } from "@/lib/prompt-engine/prompt-linter";
import { getModelProfile, type ModelProfile } from "@/lib/prompt-engine/model-profile";
import { useBuilderStore } from "@/stores/builder-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/components/ui/cn";
import { FIELD_LABEL, SEVERITY_LABEL, describeIssue, type LintField } from "./lint-labels";

const SEVERITY_META: Record<LintSeverity, { Icon: typeof Info; cls: string; order: number }> = {
  error: { Icon: CircleX, cls: "text-danger", order: 0 },
  warning: { Icon: TriangleAlert, cls: "text-warning", order: 1 },
  info: { Icon: Info, cls: "text-info", order: 2 },
};

export type ScoreTone = "success" | "warning" | "danger";

export function scoreTone(score: number): ScoreTone {
  return score >= 75 ? "success" : score >= 60 ? "warning" : "danger";
}

export interface QualityState {
  report: LintReport;
  profile: ModelProfile;
  /** Nothing entered yet: no score to show. */
  empty: boolean;
}

/** The model name for copy ("Claude Opus 5.5"), or a neutral fallback. */
export function modelLabel(profile: ModelProfile): string {
  return profile.family === "other" && profile.label === "unknown model" ? "dein Modell" : profile.label;
}

/**
 * Lints the current draft for the active model. On the form and section steps
 * the structured fields are the source; on the preview and refine steps the
 * XML is (it may have been edited by hand).
 */
export function useQualityReport(): QualityState {
  const step = useBuilderStore((s) => s.step);
  const structured = useBuilderStore((s) => s.structured);
  const xmlContent = useBuilderStore((s) => s.xmlContent);
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const activeModel = useSettingsStore((s) => s.activeModel);
  const profile = useMemo(() => getModelProfile(activeProvider, activeModel), [activeProvider, activeModel]);

  return useMemo(() => {
    const fromXml = step === "preview" || step === "refine";
    const xml = fromXml ? xmlContent : buildXml(structured);
    const data = fromXml ? parseXml(xml) : structured;
    const r = lintPrompt(data, xml, profile);
    // Most severe first; the linter's order is kept within a severity.
    const issues = r.issues
      .map((issue, i) => ({ issue, i }))
      .sort((a, b) => SEVERITY_META[a.issue.severity].order - SEVERITY_META[b.issue.severity].order || a.i - b.i)
      .map(({ issue }) => issue);
    const filled = [data.instructions, data.context, data.constraints, data.task, data.targetAudience, data.outputFormat]
      .some((v) => (v || "").trim()) || data.examples.length > 0;
    const empty = fromXml ? !xml.trim() : !filled;
    return { report: { ...r, issues }, profile, empty };
  }, [step, structured, xmlContent, profile]);
}

const GRADE_VARIANT: Record<ScoreTone, BadgeVariant> = { success: "success", warning: "warning", danger: "danger" };

/** "B · 82" badge with the score tone; text carries the value, colour only supports it. */
export function ScoreBadge({ report, className }: { report: LintReport; className?: string }) {
  return (
    <Badge variant={GRADE_VARIANT[scoreTone(report.score)]} size="md" className={cn("tabular-nums", className)}>
      <span className="sr-only">Qualität </span>
      {report.grade} · {report.score}
      <span className="sr-only"> von 100</span>
    </Badge>
  );
}

function IssueRow({ issue, onFocusField }: { issue: LintIssue; onFocusField?: (field: LintField) => void }) {
  const { Icon, cls } = SEVERITY_META[issue.severity];
  const d = describeIssue(issue);
  return (
    <li className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", cls)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-ui font-medium text-foreground">
          <span className="sr-only">{SEVERITY_LABEL[issue.severity]}: </span>
          {d.title}
        </p>
        {d.detail ? <p className="break-words text-xs text-foreground/90">{d.detail}</p> : null}
        {d.untranslated ? (
          <p lang="en" className="break-words text-xs text-muted-foreground">
            {d.untranslated}
          </p>
        ) : null}
        {d.hint ? <p className="break-words text-xs text-muted-foreground">{d.hint}</p> : null}
        {(d.field && onFocusField) || issue.sourceUrl ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0 md:gap-x-3 md:gap-y-1 md:pt-0.5">
            {d.field && onFocusField ? (
              <Button variant="link" size="xs" className="h-10 text-xs md:h-6" onClick={() => onFocusField(d.field!)}>
                Zum Feld: {FIELD_LABEL[d.field]}
              </Button>
            ) : null}
            {issue.sourceUrl ? (
              <a
                href={issue.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-6"
              >
                <ExternalLink aria-hidden className="size-3" /> Quelle
                <span className="sr-only"> (öffnet in neuem Tab)</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Rail card „Qualität": linter score plus issues that jump to their field. */
export function PromptQualityPanel({
  quality,
  onFocusField,
}: {
  quality: QualityState;
  onFocusField?: (field: LintField) => void;
}) {
  const { report, profile, empty } = quality;
  const tone = scoreTone(report.score);
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const i of report.issues) c[i.severity]++;
    return c;
  }, [report.issues]);

  return (
    <section aria-labelledby="pb-quality-title" className="rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h2 id="pb-quality-title" className="text-ui font-semibold">
            Qualität
          </h2>
          <p className="text-xs text-muted-foreground">Geprüft für {modelLabel(profile)}</p>
        </div>
        {empty ? null : <ScoreBadge report={report} />}
      </div>

      {empty ? (
        <p className="px-4 pb-4 text-ui text-muted-foreground">
          Noch nichts zu prüfen. Sobald du ein Ziel eingibst, bewertet der Linter den Prompt und zeigt, was fehlt.
        </p>
      ) : (
        <div className="space-y-3 px-4 pb-4">
          <Progress
            value={report.score}
            tone={tone}
            label="Qualitätswert"
            valueText={`${report.score} von 100`}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            ~{report.estimatedTokens.toLocaleString("de-DE")} Tokens · {report.wordCount.toLocaleString("de-DE")} Wörter
            {report.issues.length > 0 ? (
              <>
                {" · "}
                {[
                  counts.error ? `${counts.error} Fehler` : "",
                  counts.warning ? `${counts.warning} ${counts.warning === 1 ? "Warnung" : "Warnungen"}` : "",
                  counts.info ? `${counts.info} ${counts.info === 1 ? "Hinweis" : "Hinweise"}` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </>
            ) : null}
          </p>
          {report.issues.length === 0 ? (
            <p className="flex items-center gap-2 text-ui text-success">
              <CircleCheck aria-hidden className="size-4" /> Keine Auffälligkeiten – solider Prompt.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border pt-2.5">
              {report.issues.map((issue, idx) => (
                <IssueRow key={`${issue.ruleId}-${idx}`} issue={issue} onFocusField={onFocusField} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
