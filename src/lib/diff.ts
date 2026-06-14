export type DiffOp = "equal" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Minimal line-based diff via longest-common-subsequence.
 * Good enough for comparing prompt versions; no external dependency.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = aLines[i] === bLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ op: "equal", text: aLines[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "del", text: aLines[i] });
      i++;
    } else {
      out.push({ op: "add", text: bLines[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: aLines[i++] });
  while (j < m) out.push({ op: "add", text: bLines[j++] });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "del").length,
  };
}
