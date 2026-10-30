// App preferences, saved on the phone. Read anywhere with useSettings().
//
// Changing a setting is instant on screen: the control updates right away and
// the rest of the app (every card that shows a title) re-renders in the
// background as a low-priority update, so a tap never waits for it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Anime } from './types';

export type Settings = {
  titleLang: 'english' | 'romaji'; // "Attack on Titan" or "Shingeki no Kyojin"
  audioLang: 'japanese' | 'english' | 'hindi'; // the viewer's preferred audio language
  quality: 'saver' | 'medium' | 'highest'; // preferred streaming quality
};

const KEY = 'animeverse:settings:v1';
export const DEFAULT_SETTINGS: Settings = { titleLang: 'english', audioLang: 'japanese', quality: 'medium' };

type Ctx = Settings & { update: (patch: Partial<Settings>) => void; ready: boolean };
const SettingsContext = createContext<Ctx>({ ...DEFAULT_SETTINGS, update: () => {}, ready: false });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<Settings>;
        setSettings((s) => ({
          ...s,
          ...(saved.titleLang ? { titleLang: saved.titleLang } : {}),
          ...(saved.audioLang ? { audioLang: saved.audioLang } : {}),
          // Older saves used other values (auto/1080p...); those fall back to the default.
          ...(saved.quality && ['saver', 'medium', 'highest'].includes(saved.quality) ? { quality: saved.quality } : {}),
        }));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    // Low priority: the tap's own feedback is never held up by re-rendering the app.
    startTransition(() => setSettings((s) => ({ ...s, ...patch })));
  }, []);

  // Saved after the change, off the tap.
  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings, ready]);

  const value = useMemo(() => ({ ...settings, update, ready }), [settings, update, ready]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

// The name to show for a title in the chosen language.
export function displayTitle(
  a: (Pick<Anime, 'title'> & { titleRomaji?: string | null }) | null | undefined,
  lang: Settings['titleLang']
): string {
  if (!a) return '';
  return lang === 'romaji' ? a.titleRomaji || a.title : a.title;
}

export function useTitle(a: (Pick<Anime, 'title'> & { titleRomaji?: string | null }) | null | undefined) {
  const { titleLang } = useContext(SettingsContext);
  return a ? displayTitle(a, titleLang) : '';
}
