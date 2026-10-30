// Whether this phone has seen the welcome tour.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'animeverse:onboarded:v1';
let cached: boolean | null = null;

// Read once at startup (while the splash is still up).
export const loadOnboarded = () =>
  AsyncStorage.getItem(KEY)
    .then((v) => (cached = v === '1'))
    .catch(() => (cached = true)); // if storage fails, don't trap people in the tour

// The value read at startup (null until then).
export const onboarded = () => cached;

export const markOnboarded = () => {
  cached = true;
  AsyncStorage.setItem(KEY, '1').catch(() => {});
};
