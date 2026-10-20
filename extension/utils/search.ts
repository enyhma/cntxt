// Pure search-ranking helpers for the command palette (entrypoints/
// dashboard/App.tsx) — pulled out so they're testable; entrypoints/pages
// can't be unit tested in this codebase (see CLAUDE.md's Testing section),
// same reasoning as backgroundEvents.ts pulling background.ts's own
// decision logic out for the same reason.

// 3 = exact match, 2 = starts with the query, 1 = contains it somewhere
// else, 0 = no match at all. `q` must already be lowercased/trimmed by the
// caller (paletteResults' one entry point does this once, not per
// candidate) — redoing it here would be dead work on a hot per-candidate
// path.
export function matchScore(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 1;
  return 0;
}

// A tab/url-only match (the name itself didn't match) is capped below even
// a weak substring name match — a url repeats the same domain across
// dozens of tabs, which would otherwise flood the top results.
export const TAB_URL_MATCH_SCORE = 0.5;
