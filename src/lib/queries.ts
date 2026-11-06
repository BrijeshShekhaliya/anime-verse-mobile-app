// One hook per kind of data, each with its own refresh rule: data that changes
// often is re-checked sooner, data that never changes is kept for days.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchTmdbSeason, fetchTmdbShow, seriesTitle, stillFor, tmdbImagesBlocked, tmdbPosition, type TmdbEpisode, type TmdbShow } from './artwork';
import { absoluteEpisode, episodeName, seasonIndex } from './resume';
import { api } from './api';
import { fetchEpisodeGuide, fetchSeasons } from './episodeGuide';
import { fetchScheduleForDate } from './scheduleByDate';
import type { Anime, AnimeDetail } from './types';
import { fetchDetail, fetchExtras, fetchGenres, fetchHome, fetchSchedule } from '@/services/anilistClient';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Home: trending and this season move during the day.
// Also used by the splash, which loads Home before the first screen appears.
export const homeQuery = {
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
};
export function useHome() {
  return useQuery(homeQuery);
}

// Anime page: an airing show's next episode changes; a finished show doesn't.
export function useDetail(id: string) {
  return useQuery({
    queryKey: ['detail', id],
    queryFn: () => fetchDetail(id),
    // The card the user tapped is shown while the full page loads.
    placeholderData: () => api.getCachedDetail(id) ?? undefined,
    retry: 3, // a brief network or rate-limit hiccup shouldn't leave a page empty
    retryDelay: (n) => 800 * 2 ** n,
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
    queryKey: ['guide', anilistId, 'v3'],
    queryFn: () => fetchEpisodeGuide(anilistId!),
    staleTime: airing ? HOUR : 7 * DAY,
    enabled: !!anilistId,
  });
}

// Release schedule for one calendar day. Past days barely change; today and
// later are re-checked hourly. Shows on it open instantly when tapped.
export const scheduleDateOptions = (key: string, isPast: boolean) => ({
  queryKey: ['scheduleDate', key],
  queryFn: async () => {
    const items = await fetchScheduleForDate(key);
    items.forEach((a) => api.seedDetail(a));
    return items;
  },
  staleTime: isPast ? 7 * DAY : HOUR,
});

export function useScheduleDate(key: string, isPast: boolean) {
  return useQuery(scheduleDateOptions(key, isPast));
}

// ---- TMDB episode stills for the anime page ----
// The show's TMDB match and season sizes (one lookup per series, saved).
export function useTmdbShow(anime: Anime | null) {
  const key = anime ? seriesTitle(anime.title).toLowerCase() : '';
  return useQuery({
    queryKey: ['tmdbShow', key],
    queryFn: () => fetchTmdbShow(anime!),
    enabled: !!anime && !!key,
    staleTime: 7 * DAY,
  });
}

type StillMap = Map<string, TmdbEpisode>; // "season:episode" → episode
const toStillMap = (results: { data?: { season: number; eps: TmdbEpisode[] }; isPending: boolean }[]) => {
  const map: StillMap = new Map();
  for (const r of results) if (r.data) for (const e of r.data.eps) map.set(`${r.data.season}:${e.number}`, e);
  return { map, pending: results.some((r) => r.isPending) };
};

// Stills and names for absolute episodes from..to: only the TMDB seasons those
// episodes fall in are fetched (one request per season, saved on the phone).
export function useTmdbStills(show: TmdbShow | null | undefined, from: number, to: number, airing: boolean) {
  const seasons = useMemo(() => {
    if (!show || to < from) return [] as number[];
    const set = new Set<number>();
    for (const n of [from, to]) {
      const p = tmdbPosition(show, n);
      if (p) set.add(p.season);
    }
    // Every season between the first and last needed one.
    const list = [...set].sort((a, b) => a - b);
    if (list.length === 2) for (let s = list[0] + 1; s < list[1]; s++) if (show.seasons.some((x) => x.season === s)) list.push(s);
    return list;
  }, [show, from, to]);
  return useQueries({
    queries: seasons.map((season) => ({
      queryKey: ['tmdbSeason', show?.id, season],
      queryFn: async () => ({ season, eps: await fetchTmdbSeason(show!.id, season) }),
      staleTime: airing ? DAY : 7 * DAY,
    })),
    combine: toStillMap,
  });
}

// One episode's picture, using the same saved answers as the anime page. pending: still
// finding out, so nothing else is shown first and then swapped.
// With names: also the episode's name, from AniList's guide and TMDB as on the anime page.
export function useEpisodeStill(anime: Anime | null | undefined, season: number, episode: number, withName = false) {
  const fromId = anime?.id && /^al\d+$/.test(anime.id) ? Number(anime.id.slice(2)) : null;
  // Saved before the AniList id was kept: looked up once, then saved like any other page.
  const needsLookup = !!anime && !anime.anilistId && !fromId;
  const detail = useDetail(needsLookup ? anime.id : '');
  const anilistId = anime?.anilistId ?? fromId ?? detail.data?.anilistId ?? null;
  const seasonsQ = useSeasons(anime ? anilistId : null);
  const absolute = useMemo(
    () => (seasonsQ.data && anilistId && episode > 0 ? absoluteEpisode(seasonsQ.data, anilistId, season, episode) : null),
    [seasonsQ.data, anilistId, season, episode],
  );
  const show = useTmdbShow(anime ?? null);
  const stills = useTmdbStills(absolute == null ? null : show.data, absolute ?? 0, absolute ?? 0, !!anime?.airing);
  const position = show.data && absolute != null ? tmdbPosition(show.data, absolute) : null;
  const still = position && !tmdbImagesBlocked() ? stillFor(stills.map.get(`${position.season}:${position.episode}`)?.still) : null;
  const pending = (needsLookup && detail.isLoading) || seasonsQ.isLoading || show.isLoading || (absolute != null && stills.pending);
  const entry = seasonsQ.data && anilistId ? seasonIndex(seasonsQ.data, anilistId, season) : -1;
  const guide = useEpisodeGuide(withName && entry >= 0 ? seasonsQ.data![entry].anilistId : null, !!anime?.airing);
  const guideEpisode = guide.data?.find((e) => e.number === episode);
  const guideTitle = guideEpisode?.title;
  const tmdbName = position ? stills.map.get(`${position.season}:${position.episode}`)?.name : null;
  return { still, pending, name: episodeName(episode, guideTitle, tmdbName), thumb: guideEpisode?.thumb ?? null, airingAt: guideEpisode?.airingAt ?? null };
}
