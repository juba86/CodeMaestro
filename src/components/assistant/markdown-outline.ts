// Pure helper for the Markdown renderer (kept apart so it can be unit tested).

/**
 * The shallowest ATX heading depth in the text (outside code fences), so a
 * message's top heading renders as h2 under the page's h1 whatever level the
 * agent used (keeps the document outline valid).
 */
export function topHeadingDepth(text: string): number {
  let min = 7;
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(line);
    if (h) min = Math.min(min, h[1].length);
  }
  return min === 7 ? 1 : min;
}
