"use client";

import { useMemo } from "react";
import { parseXml } from "@/lib/prompt-engine/xml-parser";
import { lintPrompt, type LintSeverity } from "@/lib/prompt-engine/prompt-linter";
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";

const SEVERITY_META: Record<LintSeverity, { Icon: typeof Info; cls: string }> = {
  error: { Icon: AlertCircle, cls: "text-red-500" },
  warning: { Icon: AlertTriangle, cls: "text-amber-500" },
  info: { Icon: Info, cls: "text-blue-500" },
};

const GRADE_CLS: Record<string, string> = {
  A: "bg-green-500/15 text-green-500 border-green-500/30",
  B: "bg-lime-500/15 text-lime-500 border-lime-500/30",
  C: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  D: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  F: "bg-red-500/15 text-red-500 border-red-500/30",
};

export function PromptQualityPanel({ xmlContent }: { xmlContent: string }) {
  const report = useMemo(() => {
    const structured = parseXml(xmlContent || "");
    return lintPrompt(structured, xmlContent || "");
  }, [xmlContent]);

  if (!xmlContent.trim()) return null;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Prompt Quality</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            ~{report.estimatedTokens.toLocaleString()} tok · {report.wordCount} words
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
          <CheckCircle2 size={14} /> No issues found — solid prompt.
        </p>
      ) : (
        <ul className="space-y-2">
          {report.issues.map((issue, idx) => {
            const { Icon, cls } = SEVERITY_META[issue.severity];
            return (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <Icon size={14} className={`mt-0.5 shrink-0 ${cls}`} />
                <span>
                  {issue.message}
                  {issue.hint && (
                    <span className="block text-xs text-muted-foreground">{issue.hint}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
