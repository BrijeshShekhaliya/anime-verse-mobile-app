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
import { focusManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

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

// Only data that is worth having instantly on the next launch is saved.
const SAVED = new Set(['home', 'detail', 'extras', 'genres', 'schedule', 'episodes', 'seasons', 'guide']);

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'animeverse:query:v1',
  throttleTime: 2000,
});

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
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' &&
            (SAVED.has(String(q.queryKey[0])) ||
              // Browse without a search (the default grid and filter links), not every typed search.
              (q.queryKey[0] === 'browse' && !(q.queryKey[1] as { q?: string } | undefined)?.q)),
        },
      }}
      onSuccess={onRestored}
      onError={onRestored}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
