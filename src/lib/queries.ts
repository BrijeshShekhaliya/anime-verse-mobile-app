// One hook per kind of data, each with its own refresh rule: data that changes
// often is re-checked sooner, data that never changes is kept for days.
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { fetchEpisodeGuide, fetchSeasons } from './episodeGuide';
import type { AnimeDetail } from './types';
import { fetchDetail, fetchExtras, fetchGenres, fetchHome, fetchSchedule } from '@/services/anilistClient';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Home: trending and this season move during the day.
export function useHome() {
  return useQuery({
    queryKey: ['home'],
    queryFn: async () => {
      const home = await fetchHome();
      // Cards opened from Home show their basics instantly (see useDetail).
      for (const a of [...home.spotlight, ...home.trending, ...home.seasonNow, ...home.topRated, ...home.popular, ...home.upcoming, ...home.movies]) {
        api.seedDetail(a);
      }
      return home;
    },
    staleTime: 30 * MIN,
  });
}

// Anime page: an airing show's next episode changes; a finished show doesn't.
export function useDetail(id: string) {
  return useQuery({
    queryKey: ['detail', id],
    queryFn: () => fetchDetail(id),
    // The card the user tapped is shown while the full page loads.
    placeholderData: () => api.getCachedDetail(id) ?? undefined,
    staleTime: (q) => ((q.state.data as AnimeDetail | undefined)?.airing ? HOUR : 7 * DAY),
    enabled: !!id,
  });
}

export function useExtras(id: string) {
  return useQuery({ queryKey: ['extras', id], queryFn: () => fetchExtras(id), staleTime: 7 * DAY, enabled: !!id });
}

export function useGenres() {
  return useQuery({ queryKey: ['genres'], queryFn: fetchGenres, staleTime: 7 * DAY });
}

// The whole week at once; each day refreshes on its own after an hour.
export function useScheduleWeek(days: string[]) {
  return useQueries({
    queries: days.map((day) => ({
      queryKey: ['schedule', day],
      queryFn: async () => {
        const items = await fetchSchedule(day);
        items.forEach((a) => api.seedDetail(a)); // tapping a show opens instantly
        return items;
      },
      staleTime: HOUR,
    })),
    combine: (results) => ({
      lists: Object.fromEntries(days.map((d, i) => [d, results[i].data])) as Record<string, Awaited<ReturnType<typeof fetchSchedule>> | undefined>,
      errors: Object.fromEntries(days.map((d, i) => [d, results[i].error as Error | null])) as Record<string, Error | null>,
    }),
  });
}

// Episode list of one season: airing shows gain episodes, finished ones don't.
export function useEpisodes(id: string, season: number, airing: boolean) {
  return useQuery({
    queryKey: ['episodes', id, season],
    queryFn: () => api.episodes(id, season),
    // Never the previous season's list while another season loads.
    placeholderData: () => api.getCachedEpisodes(id, season) ?? undefined,
    staleTime: airing ? HOUR : DAY,
    enabled: !!id,
  });
}

// Anime page episode guide (AniList): the show's seasons, and one season's episodes.
export function useSeasons(anilistId: number | null) {
  return useQuery({
    // v3: smart season labels, filters unreleased seasons with 0 eps
    queryKey: ['seasons', anilistId, 'v3'],
    queryFn: () => fetchSeasons(anilistId!),
    staleTime: 7 * DAY,
    enabled: !!anilistId,
  });
}

export function useEpisodeGuide(anilistId: number | null, airing: boolean) {
  return useQuery({
    // v2: avoids duplicate cross-season S1 episode titles
    queryKey: ['guide', anilistId, 'v2'],
    queryFn: () => fetchEpisodeGuide(anilistId!),
    staleTime: airing ? HOUR : 7 * DAY,
    enabled: !!anilistId,
  });
}
