// ── Client-Side AnimeRulz Multi-Audio Stream Resolver ─────────────────────────
// Self-contained, zero-backend stream resolver with Multi-Audio (Hindi, English,
// Japanese, Tamil, Telugu) support.
// Executes directly on the mobile device (pure JS/Hermes) without passing
// through an intermediary proxy server.
//
// Features:
//   1. Session Pinning & Startup Verification (pins healthy domain, runs strictly once).
//   2. Direct AniList ID integration: /api/reanime/stream?anilist_id=...&episode=...
//   3. Multi-Audio In-Band Extraction (Ravok / Multi-1) yielding master.m3u8 with
//      Hindi, English, Japanese, etc.
//   4. Fallback-safe: returns clean StreamData or throws cleanly so the player
//      can transparently fall back to HiAnime without flashing errors.

import type { StreamAudioTrack, StreamData, SubtitleTrack } from '@/lib/types';

let AsyncStorage: any = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  // Graceful fallback for non-native test environments
}

export const ANIMERULZ_DOMAINS = [
  'https://animerulz.co.in',
  'https://animerulz.in',
];

const STORAGE_ACTIVE_DOMAIN_KEY = '@animeverse:animerulz_active_domain';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _pinnedDomain: string | null = null;
let _hasVerifiedThisSession = false;
let _verificationPromise: Promise<string> | null = null;

// In-memory stream cache and AniList ID lookup cache
const _streamCache = new Map<string, { ts: number; data: StreamData }>();
const _anilistIdCache = new Map<string, number>();
const CACHE_TTL = 15 * 60 * 1000; // 15 mins

/**
 * Validates whether signed streaming tokens (such as Ravok ?md5=...&expires=...)
 * have reached or are approaching expiry.
 */
export function isStreamUrlExpired(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const match = url.match(/[?&]expires=(\d+)/i);
    if (match && match[1]) {
      const expSeconds = parseInt(match[1], 10);
      const nowSeconds = Math.floor(Date.now() / 1000);
      return nowSeconds >= expSeconds - 120; // 2 min buffer before true expiration
    }
  } catch {}
  return false;
}

/**
 * Normalizes title for search matching
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

/**
 * Searches AnimeRulz by title to resolve its positive integer anilist_id
 */
export async function resolveAnilistIdFromTitle(title: string, domain: string): Promise<number | null> {
  const clean = cleanAnimeTitle(title).toLowerCase();
  if (!clean) return null;
  if (_anilistIdCache.has(clean)) return _anilistIdCache.get(clean)!;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch(`${domain}/api/reanime/search?q=${encodeURIComponent(clean)}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        Origin: domain,
        Referer: `${domain}/`,
        'Sec-Fetch-Site': 'same-origin',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const data = await res.json();
      const first = (data.results || []).find((r: any) => r && typeof r.anilist_id === 'number' && r.anilist_id > 0);
      if (first && first.anilist_id > 0) {
        _anilistIdCache.set(clean, first.anilist_id);
        return first.anilist_id;
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

/**
 * Fallback to direct AniList GraphQL title search to guarantee positive integer AniList ID
 */
export async function resolveAniListIdViaGraphQL(title: string): Promise<number | null> {
  const clean = cleanAnimeTitle(title);
  if (!clean) return null;
  const key = clean.toLowerCase();
  if (_anilistIdCache.has(key)) return _anilistIdCache.get(key)!;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const q = `query ($search: String) { Media(search: $search, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { id } }`;
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: q, variables: { search: clean } }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const data = await res.json();
      const id = data?.data?.Media?.id;
      if (typeof id === 'number' && id > 0) {
        _anilistIdCache.set(key, id);
        return id;
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

/**
 * Parses subtitles from PlayerJS syntax: e.g. "[English]https://cdn...jpg,[Spanish]https://..."
 */
export function parsePlayerJsSubtitles(raw: string): SubtitleTrack[] {
  if (!raw || typeof raw !== 'string') return [];
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const subtitles: SubtitleTrack[] = [];
  for (const item of items) {
    const match = item.match(/^\[([^\]]+)\](.*)$/);
    if (match) {
      const label = match[1].trim();
      const src = match[2].trim();
      if (src) {
        let lang = 'en';
        const lower = label.toLowerCase();
        if (lower.includes('english')) lang = 'en';
        else if (lower.includes('spanish')) lang = 'sp';
        else if (lower.includes('hindi')) lang = 'hi';
        else if (lower.includes('japanese')) lang = 'ja';
        else lang = lower.slice(0, 2);

        subtitles.push({
          label,
          lang,
          kind: 'subtitles',
          src,
          default: subtitles.length === 0 || lower.includes('english'),
        });
      }
    }
  }
  return subtitles;
}

/**
 * Parses all in-band audio renditions from the master playlist (Japanese, English, Hindi, Tamil, etc.)
 */
export function parseHlsAudioTracks(manifestText: string, manifestUrl: string): StreamAudioTrack[] {
  const lines = String(manifestText || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const tracks: StreamAudioTrack[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!/^#EXT-X-MEDIA:/i.test(line)) continue;

    const raw = line.slice(line.indexOf(':') + 1);
    const attrs: Record<string, string> = {};
    const attributePattern = /([A-Z0-9-]+)=(?:"((?:[^"]|"")*)"|([^,]*))(?:,|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = attributePattern.exec(raw))) {
      attrs[match[1].toUpperCase()] = (match[2] ?? match[3] ?? '')
        .replace(/""/g, '"')
        .trim();
    }

    if ((attrs.TYPE || '').toUpperCase() !== 'AUDIO') continue;

    const name = attrs.NAME || attrs.LANGUAGE || 'Audio';
    const language = attrs.LANGUAGE || '';
    let uri: string | null = null;
    if (attrs.URI) {
      try {
        uri = new URL(attrs.URI, manifestUrl).href;
      } catch {
        uri = attrs.URI;
      }
    }

    const groupId = attrs['GROUP-ID'] || null;
    const identity = [groupId || '', language.toLowerCase(), name.toLowerCase(), uri || ''].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);

    tracks.push({
      id: 'hls-audio-' + tracks.length,
      name,
      language,
      groupId,
      uri,
      isDefault: attrs.DEFAULT === 'YES',
      isAutoselect: attrs.AUTOSELECT === 'YES',
      channels: attrs.CHANNELS || null,
    });
  }

  return tracks;
}

/**
 * Unpacks Dean Edwards packed JavaScript (eval(function(p,a,c,k,e,d)...))
 */
export function unpackDeanEdwards(packedJs: string): string {
  const trimmed = String(packedJs || '').trim();
  if (!trimmed) return '';

  if (/^eval\s*\(/i.test(trimmed)) {
    try {
      const unwrapped = trimmed.replace(/^eval\s*\(/i, 'return (');
      const fn = new Function(unwrapped);
      const res = fn();
      if (typeof res === 'string') return res;
    } catch {}
  }

  const match = trimmed.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\(([\s\S]*)\)\s*\)?$/);
  if (!match) return '';

  try {
    const argsStr = match[1];
    const fn = new Function(`return (function(p,a,c,k,e,d){
      e=function(c){return(c<a?'':e(parseInt(c/a)))+((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))};
      if(!''.replace(/^/,String)){while(c--){d[e(c)]=k[c]||e(c)}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};
      while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}
      return p;
    })(${argsStr});`);
    return fn() || '';
  } catch {
    return '';
  }
}

/**
 * Startup Verification & Domain Pinning:
 * 1. Test last saved domain first. If healthy (200 OK), pin it and STOP immediately.
 * 2. If blocked or down, test remaining mirrors in the array.
 * 3. Runs strictly once per app session (never in a loop).
 */
export async function getOrVerifyActiveDomain(force = false): Promise<string> {
  if (!force && _pinnedDomain && _hasVerifiedThisSession) {
    return _pinnedDomain;
  }

  if (_verificationPromise) {
    return _verificationPromise;
  }

  _verificationPromise = (async () => {
    let saved: string | null = null;
    try {
      if (AsyncStorage) {
        saved = await AsyncStorage.getItem(STORAGE_ACTIVE_DOMAIN_KEY);
      }
    } catch {}

    const checkDomain = async (domain: string): Promise<boolean> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3500);
      try {
        const res = await fetch(`${domain}/api/reanime/filter_count`, {
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            Origin: domain,
            Referer: `${domain}/`,
            'Sec-Fetch-Site': 'same-origin',
          },
          signal: ctrl.signal,
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    };

    // 1. Test last saved domain first
    if (saved && ANIMERULZ_DOMAINS.includes(saved)) {
      const ok = await checkDomain(saved);
      if (ok) {
        _pinnedDomain = saved;
        _hasVerifiedThisSession = true;
        return saved;
      }
    }

    // 2. Fall back to testing all known mirrors
    for (const domain of ANIMERULZ_DOMAINS) {
      if (domain === saved) continue; // already tested
      const ok = await checkDomain(domain);
      if (ok) {
        _pinnedDomain = domain;
        _hasVerifiedThisSession = true;
        try {
          if (AsyncStorage) {
            await AsyncStorage.setItem(STORAGE_ACTIVE_DOMAIN_KEY, domain);
          }
        } catch {}
        return domain;
      }
    }

    // 3. Fallback default if completely offline or unreachable
    const defaultDomain = ANIMERULZ_DOMAINS[0];
    _pinnedDomain = defaultDomain;
    _hasVerifiedThisSession = true;
    return defaultDomain;
  })().finally(() => {
    _verificationPromise = null;
  });

  return _verificationPromise;
}

/**
 * Resolves Multi-Audio stream for the given anime and episode.
 */
export async function resolveAnimeRulzDirect(
  params: {
    id?: string | number;
    anilistId?: number;
    title?: string;
    episode: number;
    season?: number;
    mode?: 'sub' | 'dub';
  },
  forceRefresh = false,
): Promise<StreamData> {
  const domain = await getOrVerifyActiveDomain();
  let anilistId = params.anilistId;
  if ((!anilistId || anilistId <= 0) && params.id) {
    if (typeof params.id === 'number' && params.id > 0) {
      anilistId = params.id;
    } else if (typeof params.id === 'string') {
      if (params.id.startsWith('al')) {
        const parsed = parseInt(params.id.slice(2), 10);
        if (!isNaN(parsed) && parsed > 0) anilistId = parsed;
      } else if (/^\\d+$/.test(params.id)) {
        const parsed = parseInt(params.id, 10);
        if (!isNaN(parsed) && parsed > 0) anilistId = parsed;
      }
    }
  }

  if ((!anilistId || anilistId <= 0) && params.title) {
    try {
      const recovered = await Promise.any([
        resolveAnilistIdFromTitle(params.title, domain).then((id) => {
          if (!id) throw new Error('No id');
          return id;
        }),
        resolveAniListIdViaGraphQL(params.title).then((id) => {
          if (!id) throw new Error('No id');
          return id;
        }),
      ]);
      if (recovered) {
        anilistId = recovered;
      }
    } catch {
      // Both failed or no match
    }
  }

  if (!anilistId || anilistId <= 0) {
    throw new Error('AnimeRulz requires a valid positive anilistId');
  }

  const cacheKey = `${anilistId}:${params.episode}`.toLowerCase();
  if (!forceRefresh) {
    const hit = _streamCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL && !isStreamUrlExpired(hit.data.streamUrl)) {
      return hit.data;
    }
    if (hit) {
      _streamCache.delete(cacheKey);
    }
  }

  const ep = params.episode;

  const streamUrl = `${domain}/api/reanime/stream?anilist_id=${anilistId}&episode=${ep}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  let streamRes: any;
  try {
    const res = await fetch(streamUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        Origin: domain,
        Referer: `${domain}/watch?anilist_id=${anilistId}&ep=${ep}`,
        'Sec-Fetch-Site': 'same-origin',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`AnimeRulz stream API HTTP ${res.status}`);
    }
    streamRes = await res.json();
  } finally {
    clearTimeout(timer);
  }

  if (!streamRes || !Array.isArray(streamRes.servers) || streamRes.servers.length === 0) {
    throw new Error('No streaming servers available on AnimeRulz');
  }

  // Priority 1: Multi-Audio / Indian Server (e.g. Multi-1 on Ravok or Multi-2)
  const multiServer =
    streamRes.servers.find(
      (s: any) =>
        s &&
        (s.dataType === 'indian' || String(s.serverName || '').toLowerCase().includes('multi')),
    ) || streamRes.servers[0];

  const dataLink = multiServer?.dataLink;
  if (!dataLink) {
    throw new Error('No valid server link found on AnimeRulz');
  }

  let masterM3u8: string | null = null;
  let subtitles: SubtitleTrack[] = [];
  let referer = `${domain}/`;

  // Case A: Ravok Server (Multi-1)
  if (dataLink.includes('ravok.buzz')) {
    const hashMatch = dataLink.match(/\/video\/([a-zA-Z0-9]+)/);
    const hash = hashMatch ? hashMatch[1] : null;

    if (hash) {
      // Non-blocking background fetch for optional PlayerJS subtitles
      fetch(`https://ravok.buzz/video/${hash}`, {
        headers: { 'User-Agent': USER_AGENT, Referer: `${domain}/` },
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((pageHtml) => {
          if (!pageHtml) return;
          const subMatch = pageHtml.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']+)["']/i);
          if (subMatch && subMatch[1]) subtitles = parsePlayerJsSubtitles(subMatch[1]);
        })
        .catch(() => {});

      // High-speed Ravok getVideo extraction with 250ms retry on transient 502/rate-limit
      for (let attempt = 1; attempt <= 2 && !masterM3u8; attempt++) {
        const fetchCtrl = new AbortController();
        const fetchTimer = setTimeout(() => fetchCtrl.abort(), 3500);
        try {
          const postRes = await fetch(`https://ravok.buzz/player/index.php?data=${hash}&do=getVideo`, {
            method: 'POST',
            headers: {
              'User-Agent': USER_AGENT,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: `https://ravok.buzz/video/${hash}`,
              Origin: 'https://ravok.buzz',
            },
            body: new URLSearchParams({ hash, r: `${domain}/` }).toString(),
            signal: fetchCtrl.signal,
          });

          if (postRes && postRes.ok) {
            const videoData = await postRes.json();
            masterM3u8 = videoData.videoSource || videoData.securedLink || null;
            referer = 'https://ravok.buzz/';
            break;
          }
        } catch {
          // Attempt failed, back off and retry once
        } finally {
          clearTimeout(fetchTimer);
        }
        if (!masterM3u8 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    }
  }

  // Case B: Direct HLS in dataLink or fallback
  if (!masterM3u8 && /\.m3u8/i.test(dataLink)) {
    masterM3u8 = dataLink;
  }

  if (!masterM3u8) {
    throw new Error('Could not extract master.m3u8 from AnimeRulz server');
  }

  // Fast in-band audio tracks resolution with pre-seeded standard multi-audio fallback
  const DEFAULT_MULTI_TRACKS: StreamAudioTrack[] = [
    { id: 'hls-audio-0', name: 'Japanese', language: 'jpn', groupId: 'audio', isDefault: false, isAutoselect: true, uri: null, channels: null },
    { id: 'hls-audio-1', name: 'English', language: 'eng', groupId: 'audio', isDefault: false, isAutoselect: true, uri: null, channels: null },
    { id: 'hls-audio-2', name: 'Hindi', language: 'hin', groupId: 'audio', isDefault: false, isAutoselect: true, uri: null, channels: null },
    { id: 'hls-audio-3', name: 'Tamil', language: 'tam', groupId: 'audio', isDefault: false, isAutoselect: true, uri: null, channels: null },
    { id: 'hls-audio-4', name: 'Telugu', language: 'tel', groupId: 'audio', isDefault: false, isAutoselect: true, uri: null, channels: null },
  ];

  let audioTracks: StreamAudioTrack[] = [];
  try {
    const manCtrl = new AbortController();
    const manTimer = setTimeout(() => manCtrl.abort(), 1500); // 1.5s fast manifest timeout
    const manifestText = await fetch(masterM3u8, {
      headers: { 'User-Agent': USER_AGENT, Referer: referer },
      signal: manCtrl.signal,
    })
      .then((r) => r.text())
      .finally(() => clearTimeout(manTimer));

    audioTracks = parseHlsAudioTracks(manifestText, masterM3u8);
  } catch {
    // Non-fatal if manifest inspection times out; native ExoPlayer parses all renditions dynamically
  }

  if (!audioTracks || audioTracks.length === 0) {
    audioTracks = DEFAULT_MULTI_TRACKS;
  }

  const result: StreamData = {
    success: true,
    source: 'AnimeVerse (Multi-Audio)', // Clean, branded title - never displays "AnimeRulz"
    mode: params.mode || 'sub',
    seasonNumber: params.season || 1,
    episodeNumber: params.episode,
    streamUrl: masterM3u8,
    rawMasterUrl: masterM3u8,
    referer,
    subtitles,
    audioTracks,
  };

  _streamCache.set(cacheKey, { ts: Date.now(), data: result });
  return result;
}