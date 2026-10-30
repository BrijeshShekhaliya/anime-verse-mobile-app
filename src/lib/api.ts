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
import { hasAudioLanguage } from './audioMatch';
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

  episodes: (id: string, season = 1, refresh = false) => {
    const key = `episodes:${id}:s${season}`;
    if (refresh) memo.delete(key);
    return cached<EpisodesData>(key, 15 * 60 * 1000, () => fetchEpisodes(id, season));
  },

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
    return cached<StreamData>(key, 30 * 60 * 1000, async () => {
      const isHindiTarget = prefAudio === 'hindi' || prefAudio === 'hin' || prefAudio === 'hi';
      const memoryKey = isHindiTarget ? getProviderMemoryKey(params, 'hindi') : null;
      const rememberedProvider = memoryKey ? providerMemory.get(memoryKey) : null;

      // 1. If provider was already verified for this anime season & audio language, use it directly
      if (rememberedProvider === 'hianime') {
        try {
          const hiStream = await resolveHiAnimeDirect(params, options?.forceRefresh);
          if (hiStream && hiStream.streamUrl) {
            return hiStream;
          }
        } catch {
          // HiAnime failed or timed out; purge memory and failover to AnimeRulz
          if (memoryKey) providerMemory.delete(memoryKey);
        }
        return resolveAnimeRulzDirect(
          {
            id: params.id,
            anilistId: params.anilistId,
            title: params.title,
            episode: params.episode,
            season: params.season,
            mode: params.mode,
          },
          options?.forceRefresh,
        );
      }

      if (rememberedProvider === 'animerulz') {
        try {
          const multiStream = await resolveAnimeRulzDirect(
            {
              id: params.id,
              anilistId: params.anilistId,
              title: params.title,
              episode: params.episode,
              season: params.season,
              mode: params.mode,
            },
            options?.forceRefresh,
          );
          if (multiStream && multiStream.streamUrl) {
            return multiStream;
          }
        } catch {
          // AnimeRulz failed; purge memory and failover to HiAnime
          if (memoryKey) providerMemory.delete(memoryKey);
        }
        return resolveHiAnimeDirect(params, options?.forceRefresh);
      }

      // 2. Standard flow / unremembered provider:
      // Try AnimeRulz Multi-Audio default resolver first
      let multiStream: StreamData | null = null;
      try {
        multiStream = await resolveAnimeRulzDirect(
          {
            id: params.id,
            anilistId: params.anilistId,
            title: params.title,
            episode: params.episode,
            season: params.season,
            mode: params.mode,
          },
          options?.forceRefresh,
        );
      } catch {
        // AnimeRulz failed or episode unavailable
      }

      // If user specifically requested Hindi audio:
      if (isHindiTarget) {
        // Check if AnimeRulz actually has Hindi audio
        if (multiStream && multiStream.streamUrl && hasAudioLanguage(multiStream.audioTracks, 'hindi')) {
          if (memoryKey) providerMemory.set(memoryKey, 'animerulz');
          return multiStream;
        }

        // AnimeRulz does NOT have Hindi (or failed). Check if HiAnime has it!
        try {
          const hiStream = await resolveHiAnimeDirect(params, options?.forceRefresh);
          if (hiStream && hiStream.streamUrl) {
            if (hasAudioLanguage(hiStream.audioTracks, 'hindi')) {
              if (memoryKey) providerMemory.set(memoryKey, 'hianime');
              return hiStream;
            }
            // If HiAnime also lacks Hindi, return AnimeRulz if available (preferred fast stream)
            if (multiStream && multiStream.streamUrl) {
              if (memoryKey) providerMemory.set(memoryKey, 'animerulz');
              return multiStream;
            }
            return hiStream;
          }
        } catch {
          // HiAnime failed
        }

        // If HiAnime failed but AnimeRulz succeeded, return AnimeRulz
        if (multiStream && multiStream.streamUrl) {
          return multiStream;
        }

        throw new Error('Stream currently unavailable on all providers');
      }

      // Non-Hindi: if AnimeRulz succeeded, return immediately (sub-second fast path)
      if (multiStream && multiStream.streamUrl) {
        return multiStream;
      }

      // AnimeRulz failed; fall back to HiAnime
      return resolveHiAnimeDirect(params, options?.forceRefresh);
    });
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
