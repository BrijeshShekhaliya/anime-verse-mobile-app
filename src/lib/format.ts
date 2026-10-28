import type { Anime } from './types';

export const fmtNum = (n?: number | null) =>
  n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

export const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// Same fact line as the website, so cards and the detail page never disagree:
// a series shows series totals, a single season or film shows its own numbers.
export function factsOf(a: Anime, long = false): string[] {
  const eps = (n: number) => `${n} ${long ? 'Episodes' : 'eps'}`;
  if (a.seasonCount) {
    return [
      a.year ? String(a.year) : '',
      `${a.seasonCount} ${a.seasonCount === 1 ? 'Season' : 'Seasons'}`,
      a.episodeCount ? eps(a.episodeCount) : '',
    ].filter(Boolean);
  }
  if (a.factsPending) return [a.type || '', a.year ? String(a.year) : ''].filter(Boolean);
  return [a.type || '', a.year ? String(a.year) : '', a.episodes ? eps(a.episodes) : ''].filter(Boolean);
}

export function countdown(sec: number): string {
  if (sec <= 0) return 'Out now';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Prefer the big subscription platforms for the "Watch on" button.
const PLATFORM_ORDER = ['crunchyroll', 'netflix', 'hidive', 'amazon prime video', 'prime video', 'disney plus', 'hulu', 'max', 'bilibili tv', 'muse asia', 'ani-one asia', 'youtube'];
export function primaryStream(links: { name: string; url: string; type?: string }[] = []) {
  const streaming = links.filter((l) => !l.type || l.type === 'STREAMING');
  const rank = (n: string) => {
    const i = PLATFORM_ORDER.indexOf(n.toLowerCase());
    return i < 0 ? 50 : i;
  };
  return [...streaming].sort((x, y) => rank(x.name) - rank(y.name))[0] || null;
}
