"use client";

import { useMemo } from "react";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { lintPrompt, type LintSeverity } from "@/lib/prompt-engine/prompt-linter";
import { getModelProfile } from "@/lib/prompt-engine/model-profile";
import { useSettingsStore } from "@/stores/settings-store";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ExternalLink } from "lucide-react";

const SEVERITY_META: Record<LintSeverity, { Icon: typeof Info; cls: string; label: string; order: number }> = {
  error: { Icon: AlertCircle, cls: "text-red-500", label: "Fehler", order: 0 },
  warning: { Icon: AlertTriangle, cls: "text-amber-500", label: "Warnung", order: 1 },
  info: { Icon: Info, cls: "text-blue-500", label: "Hinweis", order: 2 },
};

const GRADE_CLS: Record<string, string> = {
  A: "bg-green-500/15 text-green-500 border-green-500/30",
  B: "bg-lime-500/15 text-lime-500 border-lime-500/30",
  C: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  D: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  F: "bg-red-500/15 text-red-500 border-red-500/30",
};

export function PromptQualityPanel({ xmlContent }: { xmlContent: string }) {
  const { activeProvider, activeModel } = useSettingsStore();
  const profile = useMemo(() => getModelProfile(activeProvider, activeModel), [activeProvider, activeModel]);

  const report = useMemo(() => {
    const structured = parseXml(xmlContent || "");
    const r = lintPrompt(structured, xmlContent || "", profile);
    // Most severe first; the linter's order is kept within a severity.
    const issues = r.issues
      .map((issue, i) => ({ issue, i }))
      .sort((a, b) => SEVERITY_META[a.issue.severity].order - SEVERITY_META[b.issue.severity].order || a.i - b.i)
      .map(({ issue }) => issue);
    return { ...r, issues };
  }, [xmlContent, profile]);

  if (!xmlContent.trim()) return null;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Prompt-Qualität</h3>
          <p className="text-[11px] text-muted-foreground">Geprüft für {profile.label}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            ~{report.estimatedTokens.toLocaleString()} tok · {report.wordCount} Wörter
          </span>
          <span
            className={`px-2 py-0.5 rounded-md border text-xs font-bold ${GRADE_CLS[report.grade]}`}
            title={`Score ${report.score}/100`}
          >
            {report.grade} · {report.score}
          </span>
        </div>
      </div>

      {/* Score bar */}
      <div className="h-1.5 w-full rounded-full bg-accent overflow-hidden">
        <div
          className={`h-full transition-all ${
            report.score >= 75 ? "bg-green-500" : report.score >= 60 ? "bg-amber-500" : "bg-red-500"
          }`}
          style={{ width: `${report.score}%` }}
        />
      </div>

      {report.issues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-green-500">
          <CheckCircle2 size={14} /> Keine Auffälligkeiten — solider Prompt.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {report.issues.map((issue, idx) => {
            const { Icon, cls, label } = SEVERITY_META[issue.severity];
            return (
              <li key={`${issue.ruleId}-${idx}`} className="flex items-start gap-2 text-sm">
                <Icon size={14} className={`mt-0.5 shrink-0 ${cls}`} aria-hidden />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                    <span className={`font-semibold uppercase tracking-wide ${cls}`}>{label}</span>
                    <code className="px-1 py-px rounded bg-accent text-muted-foreground break-all">{issue.ruleId}</code>
                  </div>
                  <p className="break-words">{issue.message}</p>
                  {issue.hint && <p className="text-xs text-muted-foreground break-words">{issue.hint}</p>}
                  {issue.sourceUrl && (
                    <a
                      href={issue.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      title={issue.sourceUrl}
                    >
                      <ExternalLink size={11} /> Quelle
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
