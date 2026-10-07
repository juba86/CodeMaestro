export type DiffOp = "equal" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

// The LCS table needs (n+1)·(m+1) cells for the CHANGED middle part. Above this
// (≈16 MB as Uint32) the middle is shown as a plain del/add block instead, so
// diffing two huge versions can't blow up memory or stall the event loop.
const MAX_LCS_CELLS = 4_000_000;

/**
 * Minimal line-based diff via longest-common-subsequence.
 * Good enough for comparing prompt versions; no external dependency.
 *
 * The common prefix and suffix are matched first (they are always part of an
 * LCS), so typical edits to large texts only pay for the region that changed.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");

  let start = 0;
  const maxStart = Math.min(aLines.length, bLines.length);
  while (start < maxStart && aLines[start] === bLines[start]) start++;
  let endA = aLines.length;
  let endB = bLines.length;
  while (endA > start && endB > start && aLines[endA - 1] === bLines[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ op: "equal", text: aLines[k] });
  diffMiddle(aLines.slice(start, endA), bLines.slice(start, endB), out);
  for (let k = endA; k < aLines.length; k++) out.push({ op: "equal", text: aLines[k] });
  return out;
}

function diffMiddle(aLines: string[], bLines: string[], out: DiffLine[]): void {
  const n = aLines.length;
  const m = bLines.length;

  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    for (const text of aLines) out.push({ op: "del", text });
    for (const text of bLines) out.push({ op: "add", text });
    return;
  }

  // LCS length table, flat: lcs[i * w + j] = LCS of aLines[i..] and bLines[j..].
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = aLines[i] === bLines[j]
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ op: "equal", text: aLines[i] });
      i++; j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      out.push({ op: "del", text: aLines[i] });
      i++;
    } else {
      out.push({ op: "add", text: bLines[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: aLines[i++] });
  while (j < m) out.push({ op: "add", text: bLines[j++] });
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "del").length,
  };
}
