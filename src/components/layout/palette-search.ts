// Pure matching for the command palette (DESIGN.md §5.5): case- and
// accent-insensitive, ranks prefix > word start > substring, keeps the
// given order within a rank. No cmdk dependency.

export interface Searchable {
  label: string;
  /** Extra words that should find the item (synonyms, paths, English names). */
  keywords?: string[];
}

/** Lower-case, accents stripped ("Einstellungen › Über" → "einstellungen › uber"). */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** 0 = no match; higher is better. Every query word must match somewhere. */
export function matchScore(item: Searchable, query: string): number {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const label = normalize(item.label);
  const extra = (item.keywords ?? []).map(normalize).join(" ");
  let score = 0;
  for (const w of words) {
    if (label.startsWith(w)) score += 4;
    else if (new RegExp(`(^|[\\s/›·_.-])${escapeRegExp(w)}`).test(label)) score += 3;
    else if (label.includes(w)) score += 2;
    else if (extra.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Items matching `query`, best first; stable within equal scores. */
export function filterItems<T extends Searchable>(items: T[], query: string): T[] {
  if (!normalize(query)) return items;
  return items
    .map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}

/** Next index for ↑/↓ with wrap-around; -1 when the list is empty. */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (((current + delta) % length) + length) % length;
}
