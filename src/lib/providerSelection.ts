/**
 * Normalizes title for search matching and memory key scoping by removing
 * seasons, parts, cours, and bracketed metadata.
 */
export function cleanAnimeTitle(title: string): string {
  return String(title || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/:\s*Season\s*\d+/i, '')
    .replace(/\s+Season\s+\d+/i, '')
    .replace(/:\s*Part\s*\d+/i, '')
    .replace(/\s+Part\s+\d+/i, '')
    .replace(/:\s*Court\s*\d+/i, '')
    .replace(/\s+Court\s+\d+/i, '')
    .trim();
}

// Provider preference cache: key `${animeKey}:s${season}:${lang}` -> 'animerulz' | 'hianime'
// Persists in-memory for the session so subsequent episodes know the winning provider immediately
export const providerMemory = new Map<string, 'animerulz' | 'hianime'>();

export function getProviderMemoryKey(
  params: { id?: string | number; anilistId?: number; title: string; season?: number },
  lang: string,
): string {
  const animeId = params.anilistId || params.id || cleanAnimeTitle(params.title).toLowerCase().trim();
  const season = params.season || 1;
  const cleanLang = (lang || '').toLowerCase().trim();
  return `${animeId}:s${season}:${cleanLang}`;
}

export function clearProviderMemory(params?: {
  id?: string | number;
  anilistId?: number;
  title?: string;
  season?: number;
}): void {
  if (!params) {
    providerMemory.clear();
    return;
  }
  const animeId = String(params.anilistId || params.id || (params.title ? cleanAnimeTitle(params.title).toLowerCase().trim() : ''));
  for (const k of Array.from(providerMemory.keys())) {
    if (animeId && k.startsWith(`${animeId}:`)) {
      if (!params.season || k.startsWith(`${animeId}:s${params.season}:`)) {
        providerMemory.delete(k);
      }
    }
  }
}
