// Data cache for the whole app (TanStack Query), saved on the phone.
//
// How it behaves:
// - Opening the app draws the saved copy at once (the splash screen stays up
//   until it has been read, so there is no loader on a normal launch).
// - A screen's data is refreshed in the background only once it is older than
//   its staleTime (see queries.ts): on open, when the app comes back from the
//   background, or with pull-to-refresh. Unchanged data causes no re-render.
// - If a refresh fails, the saved copy stays on screen.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient, type Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { chunkedStorage } from './chunkedStorage';

const DAY = 24 * 60 * 60 * 1000;
const MAX_AGE = 3 * DAY; // a saved copy older than this is not shown

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: MAX_AGE, // must cover MAX_AGE so saved data isn't dropped
      staleTime: 5 * 60 * 1000,
      retry: 1,
      retryDelay: 1500,
      refetchOnWindowFocus: true, // = app back in the foreground (see below)
      refetchOnReconnect: true,
    },
  },
});

// Only data that is worth having instantly on the next launch is saved:
// always Home, Schedule and genres; of the per-title data (anime pages,
// episode lists...) and Browse grids, only the most recently used.
const ALWAYS = new Set(['home', 'genres', 'schedule']);
const RECENT = new Set(['detail', 'extras', 'episodes', 'seasons', 'guide', 'browse']);
const RECENT_MAX = 40;

// The most recently updated queries of one kind, worked out once per save.
let recentAt = 0;
const recentSets = new Map<string, Set<Query>>();
function isRecent(q: Query) {
  const kind = String(q.queryKey[0]);
  if (Date.now() - recentAt > 1000) {
    recentSets.clear();
    recentAt = Date.now();
  }
  let set = recentSets.get(kind);
  if (!set) {
    const all = queryClient
      .getQueryCache()
      .findAll({ queryKey: [kind] })
      .filter((x) => x.state.status === 'success')
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    set = new Set(all.slice(0, RECENT_MAX));
    recentSets.set(kind, set);
  }
  return set.has(q);
}

const shouldSave = (q: Query) => {
  if (q.state.status !== 'success') return false;
  const kind = String(q.queryKey[0]);
  if (ALWAYS.has(kind)) return true;
  // Browse without a search (the default grid and filter links), not every typed search.
  if (kind === 'browse' && (q.queryKey[1] as { q?: string } | undefined)?.q) return false;
  return RECENT.has(kind) && isRecent(q);
};

// Saved in pieces: Android can't read back one stored value over ~2 MB.
const KEY = 'animeverse:query:v2';
const persister = createAsyncStoragePersister({
  storage: chunkedStorage,
  key: KEY,
  throttleTime: 2000,
});
// Earlier builds saved everything as one value, which could grow past that
// limit; delete it (deleting works even when reading doesn't).
AsyncStorage.removeItem('animeverse:query:v1').catch(() => {});

// React Native has no window focus: treat "app came back to the foreground"
// as focus, so stale screens refresh when the user returns.
function useAppStateFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
}

export function QueryProvider({ children, onRestored }: { children: ReactNode; onRestored?: () => void }) {
  useAppStateFocus();
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: MAX_AGE,
        buster: 'v1', // change when the saved data's shape changes
        dehydrateOptions: { shouldDehydrateQuery: shouldSave },
      }}
      onSuccess={onRestored}
      onError={onRestored}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
