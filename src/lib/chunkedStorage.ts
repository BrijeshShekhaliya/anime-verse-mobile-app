// AsyncStorage, but a long value is saved as several smaller pieces.
//
// On Android, AsyncStorage keeps each value in one SQLite row, and a row over
// ~2 MB can't be read back ("Row too big to fit into CursorWindow"). Splitting
// keeps every row small however big the saved data grows.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CHUNK = 400 * 1024; // characters per piece, far below the row limit

const countKey = (key: string) => `${key}::chunks`;
const partKey = (key: string, i: number) => `${key}::${i}`;

export const chunkedStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number(await AsyncStorage.getItem(countKey(key)));
    if (!count) return null;
    const parts = await AsyncStorage.multiGet(Array.from({ length: count }, (_, i) => partKey(key, i)));
    if (parts.some(([, v]) => v == null)) return null; // incomplete save: start fresh
    return parts.map(([, v]) => v).join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const count = Math.max(1, Math.ceil(value.length / CHUNK));
    const before = Number(await AsyncStorage.getItem(countKey(key))) || 0;
    await AsyncStorage.multiSet(Array.from({ length: count }, (_, i) => [partKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK)] as [string, string]));
    await AsyncStorage.setItem(countKey(key), String(count));
    // Remove pieces left over from a longer earlier save.
    if (before > count) await AsyncStorage.multiRemove(Array.from({ length: before - count }, (_, i) => partKey(key, count + i)));
  },

  async removeItem(key: string): Promise<void> {
    const count = Number(await AsyncStorage.getItem(countKey(key))) || 0;
    await AsyncStorage.multiRemove([countKey(key), ...Array.from({ length: count }, (_, i) => partKey(key, i))]);
  },
};
