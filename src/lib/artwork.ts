// TMDB artwork (posters, wide banners, title logos) on top of AniList data.
// AniList stays the source for everything else; this only swaps pictures.
// Runs entirely on the phone: no AnimeVerse server involved.
//
// Never blocks a screen: a card waits at most WAIT_MS for its TMDB picture,
// then shows the AniList one. Every lookup is saved on the phone, so the next
// launch shows TMDB art instantly with no requests at all.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Anime } from './types';

export type Art = {
  poster: string | null;
  poster2x: string | null;
  backdrop?: string | null;
  logo?: string | null;
  logoAspect?: number | null;
};
type Entry = Art & { t: number; full: boolean };

const TMDB_KEY: string =
  process.env.EXPO_PUBLIC_TMDB_API_KEY || (Constants.expoConfig?.extra as { tmdbApiKey?: string } | undefined)?.tmdbApiKey || '';
const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const KEY = 'animeverse:art:v1';
const HIT_TTL = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000; // "TMDB has nothing" is re-checked daily
const MAX_SAVED = 1500;
const CONCURRENCY = 6;
const WAIT_MS = 600; // how long a picture waits for TMDB before showing AniList's

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const notify = (id: string) => listeners.get(id)?.forEach((l) => l());

// Saved artwork is loaded once at startup; lookups wait for it so nothing
// already on the phone is fetched again.
const ready = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, Entry>;
    for (const [id, e] of Object.entries(saved)) if (!store.has(id)) store.set(id, e);
  })
  .catch(() => {})
  .finally(() => store.forEach((_, id) => notify(id)));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const newest = [...store.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, MAX_SAVED);
    AsyncStorage.setItem(KEY, JSON.stringify(Object.fromEntries(newest))).catch(() => {});
  }, 1000);
}

const isMiss = (e: Entry) => !e.poster && !e.backdrop && !e.logo;
const isFresh = (e: Entry | undefined, full: boolean): e is Entry =>
  !!e && (!full || e.full) && Date.now() - e.t < (isMiss(e) ? MISS_TTL : HIT_TTL);

// ---- TMDB matching (same rules as the website) ----
// "Black Clover Season 2", "Spy x Family Part 2", "AoT Final Season" -> series name.
export function seriesTitle(title: string) {
  return String(title || '')
    .replace(/\s*\((TV|\d{4})\)$/i, '')
    .replace(/[:\s-]*(Season|Part|Cour)\s*\d+.*$/i, '')
    .replace(/[:\s-]*(The\s+)?Final\s+(Season|Chapters?).*$/i, '')
    .replace(/\s+(2nd|3rd|\dth)\s+Season.*$/i, '')
    .replace(/\s+(II|III|IV|V)$/i, '')
    .trim();
}

// An entry for one season keeps its own AniList cover instead of the series poster.
const isSeasonEntry = (title: string) => /\b(season|part|cour|final)\b|\b(2nd|3rd|\dth)\b/i.test(title || '');

type TmdbResult = {
  id: number;
  name?: string;
  title?: string;
  genre_ids?: number[];
  origin_country?: string[];
  original_language?: string;
  first_air_date?: string;
  release_date?: string;
  popularity?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
};

function score(r: TmdbResult, year: number | null, wanted: string) {
  let s = 0;
  if ((r.genre_ids || []).includes(16)) s += 4; // Animation
  if ((r.origin_country || []).includes('JP') || r.original_language === 'ja') s += 4;
  const date = r.first_air_date || r.release_date || '';
  if (year && date.startsWith(String(year))) s += 3;
  if ((r.name || r.title || '').toLowerCase() === wanted.toLowerCase()) s += 3;
  return s + Math.min(2, (r.popularity || 0) / 50);
}

async function tmdb<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${TMDB}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// The TMDB title an anime maps to, or null when TMDB has none. Throws when TMDB
// can't be reached, so an outage is never saved as "no picture".
async function findMatch(a: Anime): Promise<{ kind: 'tv' | 'movie'; item: TmdbResult } | null> {
  const isMovie = a.type === 'Movie';
  const kind = isMovie ? 'movie' : 'tv';
  const queries = [...new Set([a.title, a.titleRomaji].filter(Boolean).map((t) => (isMovie ? t! : seriesTitle(t!))))].filter(Boolean);
  let failed = 0;
  for (const q of queries) {
    try {
      const res = await tmdb<{ results?: TmdbResult[] }>(`/search/${kind}?query=${encodeURIComponent(q)}`);
      const best = (res.results || [])
        .map((r) => ({ r, s: score(r, isMovie ? a.year ?? null : null, q) }))
        .filter((x) => x.s >= 6) // must look like Japanese animation
        .sort((x, y) => y.s - x.s)[0];
      if (best) return { kind, item: best.r };
    } catch {
      failed += 1;
    }
  }
  if (queries.length && failed === queries.length) throw new Error('TMDB unreachable');
  return null;
}

// Several cards of the same show (e.g. its seasons) share one lookup.
const matches = new Map<string, Promise<Awaited<ReturnType<typeof findMatch>>>>();
function matchFor(a: Anime) {
  const key = `${a.type === 'Movie' ? 'm' : 't'}:${seriesTitle(a.title).toLowerCase()}`;
  let p = matches.get(key);
  if (!p) {
    p = findMatch(a);
    matches.set(key, p);
    p.catch(() => matches.delete(key)); // try again next time after an outage
  }
  return p;
}

async function lookup(a: Anime, full: boolean): Promise<Art> {
  const match = await matchFor(a);
  const posterPath = isSeasonEntry(a.title) ? null : match?.item.poster_path;
  const art: Art = {
    poster: posterPath ? `${IMG}/w342${posterPath}` : null,
    poster2x: posterPath ? `${IMG}/w500${posterPath}` : null,
  };
  if (!full) return art;
  art.backdrop = null;
  art.logo = null;
  art.logoAspect = null;
  if (!match) return art;
  // Banner and title logo: TMDB's default backdrop, its best English logo.
  const d = await tmdb<{ backdrop_path?: string | null; images?: { backdrops?: any[]; logos?: any[] } }>(
    `/${match.kind}/${match.item.id}?append_to_response=images&include_image_language=en,ja,null`
  );
  const textless = (d.images?.backdrops || [])
    .filter((b) => b.iso_639_1 === null && b.width >= 1280)
    .sort((x, y) => y.vote_average - x.vote_average || y.width - x.width);
  const backdrop = d.backdrop_path || match.item.backdrop_path || textless[0]?.file_path;
  const logo = (d.images?.logos || [])
    .filter((l) => l.iso_639_1 === 'en' && String(l.file_path).endsWith('.png'))
    .sort((x, y) => y.vote_average - x.vote_average)[0];
  art.backdrop = backdrop ? `${IMG}/w1280${backdrop}` : null;
  art.logo = logo ? `${IMG}/w500${logo.file_path}` : null;
  art.logoAspect = logo?.aspect_ratio ?? null;
  return art;
}

// ---- Queue: a few lookups at a time, banners (on screen now) first ----
type Job = { a: Anime; full: boolean };
const queue: Job[] = [];
const queued = new Set<string>();
let running = 0;
let offlineUntil = 0; // TMDB unreachable: stop trying for a while

export const artworkOffline = () => !TMDB_KEY || Date.now() < offlineUntil;

export function wantArt(items: (Anime | null | undefined)[], full = false) {
  if (artworkOffline()) return;
  for (const a of items) {
    const k = `${a?.id}:${full}`;
    if (!a?.id || !a.title || queued.has(k) || isFresh(store.get(a.id), full)) continue;
    queued.add(k);
    if (full) queue.unshift({ a, full });
    else queue.push({ a, full });
  }
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    running += 1;
    run(job).finally(() => {
      running -= 1;
      queued.delete(`${job.a.id}:${job.full}`);
      pump();
    });
  }
}

async function run({ a, full }: Job) {
  await ready;
  if (isFresh(store.get(a.id), full)) return;
  try {
    const art = await lookup(a, full);
    const prev = store.get(a.id);
    // A poster-only answer never throws away a banner we already have.
    store.set(a.id, { ...(prev?.full && !full ? prev : {}), ...art, t: Date.now(), full: full || !!prev?.full });
    save();
    // Download the banner and logo now, so the page shows them without waiting.
    if (full) {
      const urls = [art.backdrop, art.logo].filter(Boolean) as string[];
      if (urls.length) Image.prefetch(urls, 'memory-disk').catch(() => {});
    }
  } catch {
    offlineUntil = Date.now() + 2 * 60 * 1000;
    queue.length = 0;
  }
  notify(a.id);
}

// ---- Hook ----
// The artwork for a title (undefined until known), and whether the screen
// should stop waiting and show what it has.
export function useArt(anime: Anime | null | undefined, full = false): { art: Art | undefined; settled: boolean; known: boolean } {
  const id = anime?.id;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!id) return () => {};
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(cb);
      return () => {
        set!.delete(cb);
        if (!set!.size) listeners.delete(id);
      };
    },
    [id]
  );
  const entry = useSyncExternalStore(subscribe, () => (id ? store.get(id) : undefined), () => undefined);

  useEffect(() => {
    if (anime) wantArt([anime], full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, full]);

  // Wait briefly for TMDB art, so a picture doesn't flash its AniList version first.
  const known = !!entry && (!full || entry.full);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (known) return;
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), WAIT_MS);
    return () => clearTimeout(t);
  }, [known, id]);

  return { art: entry, settled: known || timedOut || artworkOffline(), known };
}

// Picks the picture to show: TMDB when known, AniList otherwise.
// hiDpi: sharper poster on high-density screens (off with data saver).
export const posterOf = (a: Anime, art: Art | undefined, hiDpi = true) =>
  (art?.poster && (hiDpi ? art.poster2x || art.poster : art.poster)) || (hiDpi && a.image2x) || a.image || undefined;
export const backdropOf = (a: Anime, art: Art | undefined) => art?.backdrop || a.backdrop || a.banner || a.image || undefined;

// Settings → Clear cached data.
export function clearArtwork() {
  store.clear();
  matches.clear();
  AsyncStorage.removeItem(KEY).catch(() => {});
  [...listeners.keys()].forEach(notify);
}
