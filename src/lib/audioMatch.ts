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
