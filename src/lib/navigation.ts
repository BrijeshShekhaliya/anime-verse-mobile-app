import { router } from 'expo-router';

let isNavigatingToWatch = false;
let navTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Single-flight navigation guard to `/watch/...`.
 * Prevents rapid repeated taps on episode items or the play button from pushing
 * duplicate watch routes onto the navigation stack.
 */
export function navigateToWatchSafe(url: string, debounceMs = 650): boolean {
  if (isNavigatingToWatch) {
    return false;
  }
  isNavigatingToWatch = true;
  if (navTimer) clearTimeout(navTimer);
  navTimer = setTimeout(() => {
    isNavigatingToWatch = false;
    navTimer = null;
  }, debounceMs);

  router.push(url as any);
  return true;
}

/**
 * Resets the watch navigation lock immediately (e.g. when screen regains focus).
 */
export function resetWatchNavigationLock(): void {
  isNavigatingToWatch = false;
  if (navTimer) {
    clearTimeout(navTimer);
    navTimer = null;
  }
}
