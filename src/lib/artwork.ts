// TMDB artwork (posters, wide banners, title logos, episode stills).
// AniList stays the source for everything else; pictures come from TMDB.
// Runs entirely on the phone: no AnimeVerse server involved.
//
// A picture waits for TMDB (a placeholder shows meanwhile) and never shows an
// AniList picture first. AniList's picture is used only when TMDB has none for
// that title, or TMDB can't be reached. Every lookup is saved on the phone, so
// the next launch shows TMDB art instantly with no requests at all.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { whenIdle } from './idle';
import { decodeTmdbKey } from './tmdbKey';
import { onMobileData } from './network';
import type { Anime } from './types';

export type Art = {
  poster: string | null;
  poster2x: string | null;
  backdrop?: string | null;
  logo?: string | null;
  logoAspect?: number | null;
};
type Entry = Art & { t: number; full: boolean };

const TMDB_KEY: string = decodeTmdbKey(process.env.EXPO_PUBLIC_TMDB_KEY_ENC);
// TMDB's two API addresses. Some mobile networks block the main one, so the
// first to answer on this network is used (see tmdbBase).
const TMDB_HOSTS = ['https://api.themoviedb.org/3', 'https://api.tmdb.org/3'];
const IMG = 'https://image.tmdb.org/t/p';

const KEY = 'animeverse:art:v4'; // v4: titles once saved as "no picture" try the better matching
AsyncStorage.multiRemove(['animeverse:art:v1', 'animeverse:art:v2', 'animeverse:art:v3']).catch(() => {});
const HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL = 3 * 24 * 60 * 60 * 1000; // "TMDB has nothing" is re-checked every few days
const HOST_KEY = 'animeverse:tmdb-host';
const MAX_SAVED = 1500;
const CONCURRENCY = 6;

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
// Lists that show many titles at once (the welcome tour) listen to every change.
const anyListeners = new Set<() => void>();
let version = 0;
const notify = (id: string) => {
  version += 1;
  listeners.get(id)?.forEach((l) => l());
  anyListeners.forEach((l) => l());
};

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
  saveTimer = setTimeout(
    () =>
      whenIdle(() => {
        const newest = [...store.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, MAX_SAVED);
        AsyncStorage.setItem(KEY, JSON.stringify(Object.fromEntries(newest))).catch(() => {});
      }, 4000),
    1500
  );
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
  original_name?: string;
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

async function fetchWithin(url: string, ms: number, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Which TMDB addresses work on this network ----
// Asked once (again after a failure): both API addresses at once, first to
// answer wins. A network that blocks TMDB is known within seconds, and every
// picture falls back at once instead of each waiting for its own timeout.
let basePromise: Promise<string | null> | null = null;
let savedHostChecked = false;
function tmdbBase(): Promise<string | null> {
  if (!basePromise && !savedHostChecked) {
    // First use this launch: trust the address that worked last time. If it
    // fails, the request below clears this and the addresses are checked.
    savedHostChecked = true;
    basePromise = AsyncStorage.getItem(HOST_KEY)
      .catch(() => null)
      .then((saved) => (saved && TMDB_HOSTS.includes(saved) ? saved : ((basePromise = null), tmdbBase())));
    return basePromise;
  }
  if (!basePromise) {
    const probe = () =>
      Promise.any(
        TMDB_HOSTS.map(async (host) => {
          const res = await fetchWithin(`${host}/configuration?api_key=${TMDB_KEY}`, 5000);
          if (!res.ok) throw new Error(`TMDB ${res.status}`);
          return host;
        })
      ).catch(() => null);
    basePromise = (async () => {
      let base = await probe();
      if (!base) {
        // No answer yet: pictures waiting on screen show AniList's for now
        // (and change as soon as TMDB's arrive). One more try before pausing.
        fallingBack = true;
        modeChanged();
        await new Promise((r) => setTimeout(r, 1000));
        base = await probe();
      }
      if (!base) {
        basePromise = null; // ask again next time
        goOffline();
      } else {
        AsyncStorage.setItem(HOST_KEY, base).catch(() => {});
      }
      return base;
    })();
  }
  return basePromise;
}

// The picture server can be blocked on its own. Then saved TMDB addresses
// would just stay blank, so screens use AniList's pictures until it's back.
let imagesBlocked = false;
let imagesChecked = false;
function checkImages() {
  if (imagesChecked) return;
  imagesChecked = true;
  // Any answer (even "not found") means the server can be reached.
  fetchWithin(`${IMG}/w45/jQFsHzYKQDxvIpX42PqszYUmpn5.jpg`, 5000, { method: 'HEAD' })
    .then(() => setImagesBlocked(false))
    .catch(() => {
      setImagesBlocked(true);
      setTimeout(() => {
        imagesChecked = false;
        checkImages();
      }, 60 * 1000);
    });
}
function setImagesBlocked(blocked: boolean) {
  if (blocked === imagesBlocked) return;
  imagesBlocked = blocked;
  modeChanged();
}
export const tmdbImagesBlocked = () => imagesBlocked;
// Episode pictures show small: w300 is sharp enough there, at about half the
// data of w500 (saved answers may still hold w500 addresses).
export const stillFor = (still: string | null | undefined) => still?.replace('/w500/', '/w300/') ?? null;
// Title logos: a smaller file on mobile data.
export const logoFor = (logo: string | null | undefined) => (logo && onMobileData() ? logo.replace('/w500/', '/w300/') : logo ?? null);

let busyUntil = 0;
async function tmdb<T>(path: string): Promise<T> {
  if (Date.now() < offlineUntil) throw new Error('TMDB unreachable');
  const busy = busyUntil - Date.now();
  if (busy > 0) await new Promise((r) => setTimeout(r, busy));
  const base = await tmdbBase();
  if (!base) throw new Error('TMDB unreachable');
  let res: Response;
  try {
    res = await fetchWithin(`${base}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}`, 10000);
  } catch (e) {
    basePromise = null; // no answer: the network may have changed, check again next time
    throw e;
  }
  // A busy answer (429, or a server error) isn't a network problem: the lookup
  // just tries again in a moment.
  if (res.status === 429) {
    const seconds = Number(res.headers.get('retry-after')) || 2;
    busyUntil = Date.now() + seconds * 1000 + Math.random() * 1000;
  }
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return (await res.json()) as T;
}

// The TMDB title an anime maps to, or null when TMDB has none. Throws when TMDB
// can't be reached, so an outage is never saved as "no picture".
// Shorter forms of a title: without a trailing sequel number, and the part before
// a ":" or " - " ("Re:ZERO" stays whole: "Re" is too short to mean anything).
function mainTitles(title: string): string[] {
  const noNumber = title.replace(/\s+\d{1,2}$/, '');
  const beforeBreak = title.split(/\s*[:：]\s*|\s+-\s+/)[0].trim();
  return [noNumber, beforeBreak].filter((t) => t !== title && t.length >= 4);
}

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
  if (failed) throw new Error('TMDB unreachable'); // not a real "no picture": don't save it
  // Nothing under the full name: an arc, part or numbered sequel ("Jujutsu
  // Kaisen: Shimetsu Kaiyuu", "Kono Subarashii... 4") is usually listed on TMDB
  // under its main show. Movies are left out: their own title is the only match.
  if (isMovie) return null;
  const shorter = [...new Set(queries.flatMap(mainTitles))].filter((q) => !queries.includes(q));
  for (const q of shorter) {
    const res = await tmdb<{ results?: TmdbResult[] }>(`/search/${kind}?query=${encodeURIComponent(q)}`);
    const wanted = q.toLowerCase();
    const best = (res.results || [])
      // A short name must really be how the show's name begins ("MASHLE"), so
      // it can't land on an unrelated show that merely contains the word.
      .filter((r) => q.length >= 12 || [r.name, r.original_name].some((n) => (n || '').toLowerCase().startsWith(wanted)))
      .map((r) => ({ r, s: score(r, null, q) }))
      .filter((x) => x.s >= 6)
      .sort((x, y) => y.s - x.s)[0];
    if (best) return { kind, item: best.r };
  }
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

// One TMDB details request per show, shared by everything that needs it: the
// banner/logo lookup and the episode list's season sizes both read this reply
// (it carries the images and the seasons), instead of asking TMDB twice.
type TmdbDetails = {
  backdrop_path?: string | null;
  poster_path?: string | null;
  images?: { backdrops?: any[]; logos?: any[] };
  seasons?: { season_number: number; episode_count: number; poster_path?: string | null }[];
};
const details = new Map<string, Promise<TmdbDetails>>();
function detailsFor(kind: 'tv' | 'movie', id: number) {
  const key = `${kind}:${id}`;
  let p = details.get(key);
  if (!p) {
    p = tmdb<TmdbDetails>(`/${kind}/${id}?append_to_response=images&include_image_language=en`);
    details.set(key, p);
    p.then(
      () => setTimeout(() => details.delete(key), 10 * 60 * 1000), // keep briefly; results are saved elsewhere
      () => details.delete(key) // try again next time after an error
    );
  }
  return p;
}

// ---- Episode stills (for the anime page's episode list) ----

export type TmdbShow = { id: number; seasons: { season: number; count: number }[] };
export type TmdbEpisode = { number: number; name: string | null; still: string | null };

// The TMDB TV show for an anime (matched by its series name) and its seasons'
// episode counts, or null when TMDB has no such show.
export async function fetchTmdbShow(a: Anime): Promise<TmdbShow | null> {
  if (!TMDB_KEY) return null;
  const match = await matchFor({ ...a, type: a.type === 'Movie' ? 'TV' : a.type });
  if (!match || match.kind !== 'tv') return null;
  // Same request as the banner/logo lookup (shared), so this usually costs nothing.
  const d = await detailsFor('tv', match.item.id);
  return {
    id: match.item.id,
    seasons: (d.seasons || [])
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .sort((x, y) => x.season_number - y.season_number)
      .map((s) => ({ season: s.season_number, count: s.episode_count })),
  };
}

// One TMDB season's episodes: name and still image.
export async function fetchTmdbSeason(showId: number, season: number): Promise<TmdbEpisode[]> {
  const d = await tmdb<{ episodes?: { episode_number: number; name?: string; still_path?: string | null }[] }>(`/tv/${showId}/season/${season}`);
  return (d.episodes || []).map((e) => ({
    number: e.episode_number,
    // TMDB's placeholder names ("Episode 4") aren't real names.
    name: e.name && !/^episode\s+\d+$/i.test(e.name.trim()) ? e.name.trim() : null,
    still: e.still_path ? `${IMG}/w300${e.still_path}` : null,
  }));
}

// Maps an absolute episode number (1 = the show's first episode) to a TMDB
// season and episode, using TMDB's per-season counts.
export function tmdbPosition(show: TmdbShow, absolute: number): { season: number; episode: number } | null {
  let before = 0;
  for (const s of show.seasons) {
    if (absolute <= before + s.count) return { season: s.season, episode: absolute - before };
    before += s.count;
  }
  return null;
}

// Which TMDB season a "Season 2" / "2nd Season" / "Final Season" entry is.
function seasonOf(title: string, seasons: { season_number: number }[]): number | null {
  const n = title.match(/season\s*(\d+)/i)?.[1] || title.match(/(\d+)(?:st|nd|rd|th)\s+season/i)?.[1];
  if (n) return Number(n);
  if (/final\s+season/i.test(title)) return Math.max(0, ...seasons.map((s) => s.season_number)) || null;
  return null;
}

async function lookup(a: Anime, full: boolean): Promise<Art> {
  const match = await matchFor(a);
  let posterPath = match?.item.poster_path;
  // A season's own entry gets that season's TMDB poster (the show's otherwise).
  if (match && match.kind === 'tv' && isSeasonEntry(a.title)) {
    const d = await detailsFor('tv', match.item.id);
    const n = seasonOf(a.title, d.seasons || []);
    const season = n == null ? null : (d.seasons || []).find((s) => s.season_number === n);
    posterPath = season?.poster_path || posterPath;
  }
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
  const d = await detailsFor(match.kind, match.item.id);
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
type Job = { a: Anime; full: boolean; tries?: number };
const queue: Job[] = [];
const queued = new Set<string>();
let running = 0;
let offlineUntil = 0; // TMDB unreachable: stop trying for a while
let fallingBack = false; // TMDB isn't answering: waiting pictures show AniList's meanwhile
const OFFLINE_PAUSE = 30 * 1000;
const RETRY_LATER = 60 * 1000;
const retryAt = new Map<string, number>(); // titles whose lookups kept failing: next try
let retryTick: ReturnType<typeof setTimeout> | null = null;

// Network state changes re-render every picture on screen (a store update
// alone wouldn't: the title's own entry hasn't changed).
const modeListeners = new Set<() => void>();
let mode = 0;
function modeChanged() {
  mode += 1;
  modeListeners.forEach((l) => l());
}
const subscribeMode = (cb: () => void) => {
  modeListeners.add(cb);
  return () => {
    modeListeners.delete(cb);
  };
};
function goOffline() {
  if (Date.now() < offlineUntil) return;
  offlineUntil = Date.now() + OFFLINE_PAUSE;
  fallingBack = true;
  queue.length = 0;
  queued.clear();
  modeChanged();
  // When the pause ends, pictures on screen ask again (they keep AniList's
  // meanwhile, and change to TMDB's only if it answers).
  setTimeout(modeChanged, OFFLINE_PAUSE + 50);
}

export const artworkOffline = () => !TMDB_KEY || Date.now() < offlineUntil;

export function wantArt(items: (Anime | null | undefined)[], full = false) {
  checkImages();
  if (artworkOffline()) return;
  for (const a of [...items].reverse()) {
    const k = `${a?.id}:${full}`;
    if (!a?.id || !a.title || queued.has(k) || isFresh(store.get(a.id), full) || (retryAt.get(a.id) ?? 0) > Date.now()) continue;
    queued.add(k);
    queue.unshift({ a, full });
  }
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    if (!listeners.has(job.a.id) && !anyListeners.size) {
      queued.delete(`${job.a.id}:${job.full}`); // scrolled away: not needed any more
      continue;
    }
    running += 1;
    run(job).finally(() => {
      running -= 1;
      queued.delete(`${job.a.id}:${job.full}`);
      pump();
    });
  }
}

async function run({ a, full, tries = 0 }: Job) {
  await ready;
  if (isFresh(store.get(a.id), full)) return;
  try {
    const art = await lookup(a, full);
    const prev = store.get(a.id);
    // A poster-only answer never throws away a banner we already have.
    store.set(a.id, { ...(prev?.full && !full ? prev : {}), ...art, t: Date.now(), full: full || !!prev?.full });
    save();
    retryAt.delete(a.id);
    fallingBack = false; // TMDB is answering again
  } catch {
    // A failed lookup tries again by itself, a little later each time. If it
    // keeps failing, only this title shows AniList's picture for now.
    if (tries < 2) {
      setTimeout(() => {
        const k = `${a.id}:${full}`;
        if (queued.has(k) || isFresh(store.get(a.id), full)) return;
        queued.add(k);
        queue.push({ a, full, tries: tries + 1 });
        pump();
      }, 1500 * 2 ** tries);
    } else if (Date.now() >= offlineUntil) {
      retryAt.set(a.id, Date.now() + RETRY_LATER);
      modeChanged();
      if (!retryTick) {
        retryTick = setTimeout(() => {
          retryTick = null;
          modeChanged(); // pictures on screen ask again
        }, RETRY_LATER + 50);
      }
    }
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
  const networkMode = useSyncExternalStore(subscribeMode, () => mode, () => mode);

  useEffect(() => {
    if (anime) wantArt([anime], full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, full, networkMode]);

  // Wait for TMDB's answer, so a picture never flashes its AniList version first.
  const known = !!entry && (!full || entry.full);
  // TMDB pictures that can't be downloaded here count as none (AniList's show).
  return { art: imagesBlocked ? undefined : entry, settled: known || fallingBack || imagesBlocked || artworkOffline() || (!!id && retryAt.has(id)), known };
}

// Posters for a whole list (undefined while a title's TMDB answer is pending).
const subscribeAny = (cb: () => void) => {
  anyListeners.add(cb);
  return () => {
    anyListeners.delete(cb);
  };
};
export function usePosters(items: Anime[], hiDpi = true): (string | undefined)[] {
  useSyncExternalStore(subscribeAny, () => version, () => version);
  useSyncExternalStore(subscribeMode, () => mode, () => mode);
  useEffect(() => wantArt(items), [items]);
  return items.map((a) => {
    const e = store.get(a.id);
    return e || fallingBack || imagesBlocked || artworkOffline() || retryAt.has(a.id) ? posterOf(a, imagesBlocked ? undefined : e, hiDpi) : undefined;
  });
}

// Resolves once these titles' posters are known and downloaded (or after ms),
// so a screen can appear with its pictures already there.
export function whenPostersReady(items: Anime[], ms: number): Promise<void> {
  wantArt(items);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      anyListeners.delete(check);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(finish, ms);
    const check = () => {
      if (!items.every((a) => store.has(a.id)) && !artworkOffline()) return;
      anyListeners.delete(check);
      const urls = items.map((a) => posterOf(a, imagesBlocked ? undefined : store.get(a.id), true)).filter(Boolean) as string[];
      Image.prefetch(urls, 'memory-disk').catch(() => {}).finally(finish);
    };
    anyListeners.add(check);
    ready.then(check);
  });
}

// Picks the picture to show: TMDB when known, AniList otherwise.
// hiDpi: sharper poster on high-density screens (off with data saver).
export const posterOf = (a: Anime, art: Art | undefined, hiDpi = true) =>
  (art?.poster && (hiDpi ? art.poster2x || art.poster : art.poster)) || (hiDpi && a.image2x) || a.image || undefined;
// Small list thumbnails (schedule, history, search): a smaller TMDB file that
// downloads several times faster and still looks sharp at that size.
export const thumbOf = (a: Anime, art: Art | undefined) => {
  const uri = posterOf(a, art, false);
  return uri?.startsWith(IMG) ? uri.replace('/w342/', '/w185/') : uri;
};
export const backdropOf = (a: Anime, art: Art | undefined, small = false) => {
  const tmdbBackdrop = small || onMobileData() ? art?.backdrop?.replace('/w1280/', '/w780/') : art?.backdrop;
  return tmdbBackdrop || a.backdrop || a.banner || a.image || undefined;
};

// Settings → Clear cached data.
export function clearArtwork() {
  store.clear();
  matches.clear();
  AsyncStorage.removeItem(KEY).catch(() => {});
  [...listeners.keys()].forEach(notify);
}
