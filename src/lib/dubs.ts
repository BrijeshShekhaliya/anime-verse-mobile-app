// English dub availability, from the open-source MAL-Dubs list
// (https://github.com/MAL-Dubs/MAL-Dubs, AGPL-3.0), keyed by MyAnimeList id.
// The same list the website uses, read straight from GitHub on the phone
// (about 60 KB), saved on the phone and refreshed twice a day.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { Languages } from './types';

const URL = 'https://raw.githubusercontent.com/MAL-Dubs/MAL-Dubs/main/data/dubInfo.json';
const KEY = 'animeverse:dubs:v1';
const REFRESH_MS = 12 * 60 * 60 * 1000;

let dubbed = new Set<number>();
let partial = new Set<number>();
let version = 0;
const listeners = new Set<() => void>();

function apply(list: { dubbed?: number[]; incomplete?: number[] }) {
  dubbed = new Set(list.dubbed || []);
  partial = new Set(list.incomplete || []);
  version += 1;
  listeners.forEach((l) => l());
}

async function download() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`dubs ${res.status}`);
    const data = (await res.json()) as { dubbed?: number[]; incomplete?: number[] };
    apply(data);
    AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), dubbed: data.dubbed, incomplete: data.incomplete })).catch(() => {});
  } finally {
    clearTimeout(t);
  }
}

// Saved copy first (instant); downloaded when missing or older than 12 hours.
export const dubsReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then(async (raw) => {
    const saved = raw ? (JSON.parse(raw) as { at: number; dubbed?: number[]; incomplete?: number[] }) : null;
    if (saved?.dubbed?.length) {
      apply(saved);
      if (Date.now() - saved.at > REFRESH_MS) download().catch(() => {});
      return;
    }
    await download();
  })
  .catch(() => {});

const malOf = (a: { id?: string; malId?: number | null }) => a.malId ?? (a.id && /^\d+$/.test(a.id) ? Number(a.id) : null);

// 'full', 'partial' (still being dubbed) or null.
export function dubOf(a: { id?: string; malId?: number | null }): Languages['dub'] {
  const id = malOf(a);
  if (!id) return null;
  return partial.has(id) ? 'partial' : dubbed.has(id) ? 'full' : null;
}

export function languagesFor(malId: number | null | undefined): Languages {
  const dub = dubOf({ malId });
  return { audio: ['Japanese', ...(dub ? ['English'] : [])], subtitles: ['English'], sub: true, dub };
}

// Every dubbed title's MyAnimeList id (for Browse's "English dub" filter).
export async function dubbedMalIds(): Promise<number[]> {
  await dubsReady;
  return [...dubbed, ...partial];
}

// Re-renders once the list has loaded (or refreshed).
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
export const useDubs = () => useSyncExternalStore(subscribe, () => version, () => version);
