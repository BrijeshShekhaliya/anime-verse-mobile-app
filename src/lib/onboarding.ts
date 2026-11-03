// Whether this phone has seen the welcome tour.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Anime, Home } from './types';

const KEY = 'animeverse:onboarded:v1';
let cached: boolean | null = null;

// Read once at startup (while the splash is still up).
export const loadOnboarded = () =>
  AsyncStorage.getItem(KEY)
    .then((v) => (cached = v === '1'))
    .catch(() => (cached = true)); // if storage fails, don't trap people in the tour

// The value read at startup (null until then).
export const onboarded = () => cached;

// The titles the welcome tour's posters come from (the splash downloads the
// first ones before the tour appears).
export function tourItems(home: Home | undefined): Anime[] {
  const seen = new Set<string>();
  return [...(home?.trending || []), ...(home?.popular || []), ...(home?.topRated || [])].filter((a) => a.image && !seen.has(a.id) && seen.add(a.id));
}
export const TOUR_FIRST = 16;

export const markOnboarded = () => {
  cached = true;
  AsyncStorage.setItem(KEY, '1').catch(() => {});
};
