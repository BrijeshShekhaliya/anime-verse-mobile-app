let Constants: any = null;
try {
  Constants = require('expo-constants')?.default || require('expo-constants');
} catch {}
import type { Anime, AnimeDetail, Character, EpisodesData, Home, SearchResult, StreamData } from './types';
import {
  fetchDetail,
  fetchEpisodes,
  fetchExtras,
  fetchGenres,
  fetchHome,
  fetchSchedule,
  fetchSearch,
  buildAnilistSeasons,
  type SearchParams,
} from '@/services/anilistClient';
import { resolveAnimeRulzDirect, isStreamUrlExpired } from '@/services/animerulzClient';
import { resolveHiAnimeDirect } from '@/services/hianimeClient';
import { askMain, canAskMain, pickServer } from './streamRouter';
import {
  providerMemory,
  getProviderMemoryKey,
  clearProviderMemory,
} from './providerSelection';

export { providerMemory, getProviderMemoryKey, clearProviderMemory };

export type { SearchParams };

// Standalone mobile client: No AWS backend required. Everything executes directly
// on-device (AniList GraphQL for rich metadata + HiAnime direct client for streaming).
export const BASE: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  '';

export const toFullUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (BASE) return `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  return url;
};

// In-memory memo cache and in-flight promise deduplication
type Entry = { t: number; data: unknown };
const memo = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function seedDetail(anime: Anime | AnimeDetail | null | undefined) {
  if (!anime || !anime.id) return;
  const key = `detail:${anime.id}`;
  if (!memo.has(key)) {
    memo.set(key, { t: Date.now(), data: anime });
  }
}

export function getCachedDetail(id: string): AnimeDetail | null {
  const hit = memo.get(`detail:${id}`);
  return hit ? (hit.data as AnimeDetail) : null;
}

export function getCachedEpisodes(id: string, season = 1): EpisodesData | null {
  const hit = memo.get(`episodes:${id}:s${season}`);
  return hit ? (hit.data as EpisodesData) : null;
}

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const promise = (async () => {
    try {
      const data = await loader();
      memo.set(key, { t: Date.now(), data });
      return data;
    } catch (err) {
      if (hit) return hit.data as T; // stale beats an error screen
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export const api = {
  home: async (): Promise<Home> => {
    const data = await cached<Home>('home', 10 * 60 * 1000, () => fetchHome());
    // Auto-seed all cards in cache for instantaneous 0ms detail opening
    const all = [
      ...(data.spotlight || []),
      ...(data.trending || []),
      ...(data.seasonNow || []),
      ...(data.topRated || []),
      ...(data.popular || []),
      ...(data.upcoming || []),
      ...(data.movies || []),
    ];
    for (const a of all) {
      seedDetail(a);
    }
    return data;
  },

  detail: (id: string) =>
    cached<AnimeDetail>(`detail:${id}`, 30 * 60 * 1000, () => fetchDetail(id)),

  extras: (id: string) =>
    cached<{ characters: Character[]; recommendations: Anime[] }>(
      `extras:${id}`,
      30 * 60 * 1000,
      () => fetchExtras(id),
    ),

  search: async (p: SearchParams): Promise<SearchResult> => {
    const res = await cached<SearchResult>(`search:${JSON.stringify(p)}`, 5 * 60 * 1000, () => fetchSearch(p));
    // Auto-seed search results so tapping opens immediately
    for (const item of res.items || []) {
      seedDetail(item);
    }
    return res;
  },

  schedule: (day: string) =>
    cached<Anime[]>(`schedule:${day.toLowerCase()}`, 30 * 60 * 1000, () => fetchSchedule(day)),

  genres: () => cached<string[]>('genres', 24 * 60 * 60 * 1000, () => fetchGenres()),

  // detail: the anime's full details when the caller has them (saves a request).
  episodes: (id: string, season = 1, refresh = false, detail?: AnimeDetail) => {
    const key = `episodes:${id}:s${season}`;
    if (refresh) memo.delete(key);
    return cached<EpisodesData>(key, 15 * 60 * 1000, () => fetchEpisodes(id, season, detail));
  },

  // The single-language server, for when the main one won't play an episode.
  // The answer's own mode says what it really is: sub, if there's no dub.
  resolveBackup: (params: { title: string; romaji?: string; season: number; episode: number; mode: 'sub' | 'dub' }, fresh = true) =>
    resolveHiAnimeDirect(params, fresh).catch(() => resolveHiAnimeDirect({ ...params, mode: params.mode === 'dub' ? 'sub' : 'dub' }, fresh)),

  resolveStream: async (
    params: {
      id?: string | number;
      anilistId?: number;
      title: string;
      romaji?: string;
      season: number;
      episode: number;
      mode: 'sub' | 'dub';
      preferredAudio?: string;
    },
    options?: { forceRefresh?: boolean },
  ): Promise<StreamData> => {
    const prefAudio = (params.preferredAudio || '').toLowerCase().trim();
    const key = `stream:${params.id || ''}:${params.anilistId || ''}:${params.title}:${params.season}:${params.episode}:${params.mode}:${prefAudio}`.toLowerCase();
    if (options?.forceRefresh) memo.delete(key);
    const cachedEntry = memo.get(key);
    if (cachedEntry && isStreamUrlExpired((cachedEntry.data as StreamData)?.streamUrl)) {
      memo.delete(key);
    }
    const force = options?.forceRefresh;
    const stream = await cached<StreamData>(key, 15 * 60 * 1000, () =>
      pickServer({
        main: () =>
          resolveAnimeRulzDirect(
            { id: params.id, anilistId: params.anilistId, title: params.title, episode: params.episode, season: params.season, mode: params.mode },
            force,
          ),
        backup: () =>
          // An episode with only the other kind is still better than nothing.
          resolveHiAnimeDirect(params, force).catch(() => resolveHiAnimeDirect({ ...params, mode: params.mode === 'dub' ? 'sub' : 'dub' }, force)),
      }),
    );
    // The backup only stands in. Kept, one failed moment would decide this
    // episode's server (and its one language) for the next 15 minutes.
    if (!stream?.source?.toLowerCase().includes('multi')) memo.delete(key);
    return stream;
  },

  // A viewer on the backup asks for the main server: one try, even during its rest.
  resolveMain: (anilistId: number, episode: number, mode: 'sub' | 'dub'): Promise<StreamData> =>
    askMain(() => resolveAnimeRulzDirect({ anilistId, episode, mode }, true)),

  // Finds the address of an episode someone is about to play, so tapping play
  // doesn't have to wait for it. Two small requests; the real lookup shares the answer.
  prewarmStream: (anilistId: number | null | undefined, episode: number, mode: 'sub' | 'dub') => {
    if (anilistId && episode > 0 && canAskMain()) resolveAnimeRulzDirect({ anilistId, episode, mode }).catch(() => {});
  },

  clearStreamCache: (params: {
    id?: string | number;
    anilistId?: number;
    title: string;
    romaji?: string;
    season: number;
    episode: number;
    mode: 'sub' | 'dub';
  }) => {
    for (const k of Array.from(memo.keys())) {
      if (
        (params.id && k.startsWith(`stream:${params.id}:`)) ||
        k.includes(`:${params.title.toLowerCase()}:${params.season}:${params.episode}:`)
      ) {
        memo.delete(k);
      }
    }
    clearProviderMemory(params);
  },

  seedDetail,
  getCachedDetail,
  getCachedEpisodes,
  buildAnilistSeasons,
  providerMemory,
  getProviderMemoryKey,
  clearProviderMemory,
};
