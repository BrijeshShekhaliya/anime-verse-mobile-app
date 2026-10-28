import type { Anime } from './types';

const norm = (s?: string | null) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// How well a title matches what was typed (lower is better):
// 0 exact, 1 starts with it, 2 a word starts with it, 3 contains it,
// 4 only the romaji/Japanese title matches, 5 no visible match.
function matchRank(a: Anime, q: string): number {
  const t = norm(a.title);
  const alt = `${norm(a.titleRomaji)} ${norm(a.titleJapanese)}`;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (` ${t}`.includes(` ${q}`)) return 2;
  if (t.includes(q)) return 3;
  if (alt.includes(q)) return 4;
  return 5;
}

// Puts titles that actually contain the search ("solo" → "Solo Leveling")
// first, keeping the server's popularity order inside each group.
export function rankByQuery(items: Anime[], query: string): Anime[] {
  const q = norm(query);
  if (!q) return items;
  return items
    .map((a, i) => ({ a, i, r: matchRank(a, q) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}
