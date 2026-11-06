// Everything the app remembers on the device: recently viewed titles (history),
// My List, episode progress (for "Continue Watching") and recent searches.
// Stored with AsyncStorage; nothing leaves the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Anime } from './types';

// A light copy of a title: enough to draw a card without a network request.
export type SavedTitle = Pick<
  Anime,
  'id' | 'title' | 'titleRomaji' | 'image' | 'image2x' | 'banner' | 'backdrop' | 'type' | 'year' | 'score' | 'episodes' | 'episodeCount' | 'seasonCount' | 'languages' | 'airing' | 'anilistId'
>;

export type HistoryEntry = { anime: SavedTitle; at: number };
export type ListEntry = { anime: SavedTitle; at: number };

export type ProgressOptions = {
  audio?: string;
  season?: number;
  time?: number;
  duration?: number;
  completed?: boolean;
  watch?: { url: string; name: string } | null;
};

export type Progress = {
  anime: SavedTitle;
  season?: number; // missing on older saves: season 1
  audio?: string; // the language picked in the player for this show
  episode: number; // the episode currently watched or last finished
  total: number | null;
  time?: number;
  duration?: number;
  completed?: boolean; // true only when finished (>85% or ended)
  watchUrl: string | null; // official platform to continue on
  watchName: string | null;
  updatedAt: number;
};

type State = {
  history: HistoryEntry[];
  list: ListEntry[];
  progress: Record<string, Progress>;
  searches: string[];
};

const KEY = 'animeverse:library:v1';
const EMPTY: State = { history: [], list: [], progress: {}, searches: [] };
const HISTORY_MAX = 60;

export const slim = (a: Anime): SavedTitle => ({
  id: a.id,
  title: a.title,
  titleRomaji: a.titleRomaji,
  image: a.image,
  image2x: a.image2x,
  banner: a.banner,
  backdrop: a.backdrop,
  type: a.type,
  year: a.year,
  score: a.score,
  episodes: a.episodes,
  episodeCount: a.episodeCount,
  seasonCount: a.seasonCount,
  languages: a.languages,
  airing: a.airing,
  anilistId: a.anilistId,
});

type Library = State & {
  ready: boolean;
  recordView: (a: Anime) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  inList: (id: string) => boolean;
  toggleList: (a: Anime) => boolean;
  setProgress: (
    a: Anime,
    episode: number,
    total: number | null,
    extra?: ProgressOptions | { url: string; name: string } | null,
  ) => void;
  clearProgress: (id: string) => void;
  continueWatching: Progress[];
  addSearch: (q: string) => void;
  clearSearches: () => void;
};

const Ctx = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved: State = { ...EMPTY, ...JSON.parse(raw) };
        // Older versions added every opened page to history; keep only titles
        // that have watch progress.
        saved.history = saved.history.filter((h) => saved.progress[h.anime.id]);
        setState(saved);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Batch writes: many quick changes become one save.
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
    }, AppState.currentState === 'active' ? 300 : 0);
  }, [state, ready]);

  const recordView = useCallback((a: Anime) => {
    setState((s) => {
      if (s.history[0]?.anime.id === a.id) return s;
      return {
        ...s,
        history: [{ anime: slim(a), at: Date.now() }, ...s.history.filter((h) => h.anime.id !== a.id)].slice(0, HISTORY_MAX),
      };
    });
  }, []);

  const removeHistory = useCallback((id: string) => {
    setState((s) => ({ ...s, history: s.history.filter((h) => h.anime.id !== id) }));
  }, []);

  const clearHistory = useCallback(() => setState((s) => ({ ...s, history: [] })), []);

  const inList = useCallback((id: string) => state.list.some((l) => l.anime.id === id), [state.list]);

  const toggleList = useCallback(
    (a: Anime) => {
      const has = state.list.some((l) => l.anime.id === a.id);
      setState((s) => ({
        ...s,
        list: has ? s.list.filter((l) => l.anime.id !== a.id) : [{ anime: slim(a), at: Date.now() }, ...s.list],
      }));
      return !has;
    },
    [state.list]
  );

  const setProgress = useCallback(
    (
      a: Anime,
      episode: number,
      total: number | null,
      extra?: ProgressOptions | { url: string; name: string } | null,
    ) => {
      const opts: ProgressOptions =
        extra && 'url' in extra
          ? { watch: extra }
          : (extra as ProgressOptions) || {};

      startTransition(() => setState((s) => {
        const existing = s.progress[a.id];
        const nextSeason = opts.season ?? existing?.season ?? 1;
        const nextAudio = opts.audio ?? existing?.audio;
        // Episode 3 of another season is a different episode.
        const sameEpisode = existing?.episode === episode && (existing?.season ?? 1) === nextSeason;
        const nextCompleted =
          opts.completed !== undefined
            ? opts.completed
            : sameEpisode
            ? existing?.completed
            : false;
        const nextTime =
          opts.time !== undefined
            ? opts.time
            : sameEpisode
            ? existing?.time
            : 0;
        const nextDuration =
          opts.duration !== undefined
            ? opts.duration
            : sameEpisode
            ? existing?.duration
            : 0;
        const nextWatchUrl = opts.watch?.url ?? existing?.watchUrl ?? null;
        const nextWatchName = opts.watch?.name ?? existing?.watchName ?? null;

        if (
          existing &&
          sameEpisode &&
          existing.audio === nextAudio &&
          existing.total === total &&
          existing.completed === nextCompleted &&
          existing.time === nextTime &&
          existing.duration === nextDuration &&
          existing.watchUrl === nextWatchUrl &&
          existing.watchName === nextWatchName
        ) {
          return s;
        }

        const progress = { ...s.progress };
        if (episode <= 0) {
          delete progress[a.id];
        } else {
          progress[a.id] = {
            anime: slim(a),
            season: nextSeason,
            audio: nextAudio,
            episode,
            total,
            time: nextTime,
            duration: nextDuration,
            completed: nextCompleted,
            watchUrl: nextWatchUrl,
            watchName: nextWatchName,
            updatedAt: Date.now(),
          };
        }

        // History is what you've actually watched, so it's recorded here
        // (not when a detail page is opened).
        const history =
          episode > 0
            ? [{ anime: slim(a), at: Date.now() }, ...s.history.filter((h) => h.anime.id !== a.id)].slice(0, HISTORY_MAX)
            : s.history;
        return { ...s, progress, history };
      }));
    },
    []
  );

  const clearProgress = useCallback((id: string) => {
    setState((s) => {
      const progress = { ...s.progress };
      delete progress[id];
      return { ...s, progress };
    });
  }, []);

  const addSearch = useCallback((q: string) => {
    const term = q.trim();
    if (term.length < 2) return;
    setState((s) => ({ ...s, searches: [term, ...s.searches.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8) }));
  }, []);

  const clearSearches = useCallback(() => setState((s) => ({ ...s, searches: [] })), []);

  // Started but not finished, most recently updated first.
  const continueWatching = useMemo(
    () =>
      Object.values(state.progress)
        .filter((p) => !p.total || (p.completed ? p.episode < p.total : p.episode <= p.total))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.progress]
  );

  const value = useMemo<Library>(
    () => ({
      ...state,
      ready,
      recordView,
      removeHistory,
      clearHistory,
      inList,
      toggleList,
      setProgress,
      clearProgress,
      continueWatching,
      addSearch,
      clearSearches,
    }),
    [state, ready, recordView, removeHistory, clearHistory, inList, toggleList, setProgress, clearProgress, continueWatching, addSearch, clearSearches]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): Library {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary must be used inside LibraryProvider');
  return v;
}
