import type { StreamAudioTrack } from './types';

/**
 * Utility for robust multilingual audio track matching across ISO-639-1 ('hi', 'en', 'ja'),
 * ISO-639-2 ('hin', 'eng', 'jpn'), and descriptive names ('Hindi', 'English', etc.)
 */
export function isAudioLanguageMatch(trackName: string, trackLang: string, targetLang: string): boolean {
  const name = String(trackName || '').toLowerCase();
  const lang = String(trackLang || '').toLowerCase();
  const target = String(targetLang || '').toLowerCase().trim();
  if (!target) return false;

  if (target.includes('hindi') || target === 'hin' || target === 'hi') {
    return name.includes('hindi') || lang === 'hin' || lang === 'hi' || lang.startsWith('hi');
  }
  if (target.includes('english') || target === 'eng' || target === 'en') {
    return name.includes('english') || name.includes('dub') || lang === 'eng' || lang === 'en' || lang.startsWith('en');
  }
  if (target.includes('japanese') || target === 'jpn' || target === 'ja') {
    return name.includes('japanese') || name.includes('sub') || lang === 'jpn' || lang === 'ja' || lang.startsWith('ja');
  }
  if (target.includes('tamil') || target === 'tam' || target === 'ta') {
    return name.includes('tamil') || lang === 'tam' || lang === 'ta' || lang.startsWith('ta');
  }
  if (target.includes('telugu') || target === 'tel' || target === 'te') {
    return name.includes('telugu') || lang === 'tel' || lang === 'te' || lang.startsWith('te');
  }
  return name.includes(target) || lang === target;
}

/**
 * Checks whether an array of audio tracks contains a track matching the target language.
 */
export function hasAudioLanguage(tracks: StreamAudioTrack[] | undefined | null, targetLang: string): boolean {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return false;
  return tracks.some((t) => isAudioLanguageMatch(t.name || '', t.language || '', targetLang));
}

// ── Which language plays ─────────────────────────────────────────────────────
// The order everywhere: the viewer's first language, their second, then Japanese,
// then English. Falling back never changes the preference, so the next episode asks
// for the first language again.
type Track = { name: string; lang: string; selected?: boolean };

// Which kind of stream to ask the backup for. It only carries Japanese (sub) and
// English (dub), so it goes by the first of the viewer's languages it can have.
export function modeForLanguage(preferred: string | null | undefined, second?: string | null): 'sub' | 'dub' {
  for (const language of [preferred, second]) {
    const value = String(language || '').trim();
    if (/english|^eng?$/i.test(value)) return 'dub';
    if (/japan|^jpn$|^ja$/i.test(value)) return 'sub';
  }
  return 'sub';
}

export function pickAudioTrack<T extends Track>(tracks: T[], preferred: string | null | undefined, second?: string | null): T | undefined {
  const find = (language: string) => tracks.find((t) => isAudioLanguageMatch(t.name, t.lang, language));
  return (preferred ? find(preferred) : undefined) || (second ? find(second) : undefined) || find('japanese') || find('english') || tracks.find((t) => t.selected) || tracks[0];
}

// The second language can't be the first one: if they match, it moves on.
export function secondLanguageFor<T extends string>(first: string, saved: T | null | undefined): T | 'japanese' | 'english' {
  if (saved && saved !== first) return saved;
  return first === 'japanese' ? 'english' : 'japanese';
}

// What a server lists for this episode but the stream playing doesn't carry: still
// offered, so English stays in the menu even while Japanese plays.
export function missingModes<T extends Track>(tracks: T[], modes: Array<'sub' | 'dub'> | null | undefined): Array<'sub' | 'dub'> {
  return (modes ?? []).filter((m) => !tracks.some((t) => isAudioLanguageMatch(t.name, t.lang, m === 'dub' ? 'english' : 'japanese')));
}
