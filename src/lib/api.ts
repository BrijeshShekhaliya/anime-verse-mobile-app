import Constants from 'expo-constants';
import type { Anime, AnimeDetail, Character, Home, SearchResult } from './types';

// Same backend as the website. Override with EXPO_PUBLIC_API_URL for a local server.
const BASE: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'https://13.236.161.33.sslip.io';

// One request per URL at a time (screens asking for the same thing share it),
// a short memory so going back is instant, one quiet retry on network blips,
// and the last good copy if the server can't answer.
type Entry = { t: number; data: unknown };
const memo = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function get<T>(path: string, ttlMs = 5 * 60 * 1000): Promise<T> {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data as T;
  const running = inflight.get(path);
  if (running) return running as Promise<T>;

  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${BASE}/api${path}`, { signal: controller.signal });
      if (!res.ok) {
        const err = new Error(res.status === 404 ? 'Not found' : `Request failed (${res.status})`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  };

  const promise = (async () => {
    try {
      let data: T;
      try {
        data = await attempt();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status && status < 500) throw err;
        await new Promise((r) => setTimeout(r, 800));
        data = await attempt();
      }
      memo.set(path, { t: Date.now(), data });
      return data;
    } catch (err) {
      if (hit) return hit.data as T; // stale beats an error screen
      throw err;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, promise);
  return promise;
}

export type SearchParams = {
  q?: string;
  genre?: string;
  type?: string;
  status?: string;
  order?: string;
  dub?: boolean;
  page?: number;
};

export const api = {
  home: () => get<Home>('/home', 10 * 60 * 1000),
  detail: (id: string) => get<AnimeDetail>(`/anime/${encodeURIComponent(id)}`, 30 * 60 * 1000),
  extras: (id: string) =>
    get<{ characters: Character[]; recommendations: Anime[] }>(`/anime/${encodeURIComponent(id)}/extras`, 30 * 60 * 1000),
  search: (p: SearchParams) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set('q', p.q);
    if (p.genre) qs.set('genre', p.genre);
    if (p.type) qs.set('type', p.type);
    if (p.status) qs.set('status', p.status);
    if (p.order) qs.set('order', p.order);
    if (p.dub) qs.set('dub', '1');
    if (p.page && p.page > 1) qs.set('page', String(p.page));
    return get<SearchResult>(`/search?${qs}`);
  },
  schedule: (day: string) => get<Anime[]>(`/schedule/${day}`, 30 * 60 * 1000),
  genres: () => get<string[]>('/genres', 24 * 60 * 60 * 1000),
};
