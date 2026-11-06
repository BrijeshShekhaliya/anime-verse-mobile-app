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

// If the site moves, edit config/stream-domains.json in this app's GitHub repo and
// every installed app finds the new address within a day, with no update needed.
const DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/BrijeshShekhaliya/anime-verse-mobile-app/main/config/stream-domains.json';
const STORAGE_DOMAIN_LIST_KEY = '@animeverse:animerulz_domain_list';
const DOMAIN_LIST_REFRESH_MS = 24 * 60 * 60 * 1000;

let _domains: string[] = [...ANIMERULZ_DOMAINS];
let _domainListAt = 0;

// Only plain https addresses count; the built-in ones always stay as a fallback.
export function mergeDomainList(list: unknown): string[] {
  const fresh = (Array.isArray(list) ? list : [])
    .filter((d): d is string => typeof d === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(d))
    .slice(0, 10);
  return [...new Set([...fresh, ...ANIMERULZ_DOMAINS])];
}

async function refreshDomainList(): Promise<void> {
  if (Date.now() - _domainListAt < DOMAIN_LIST_REFRESH_MS) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(DOMAIN_LIST_URL, { signal: ctrl.signal });
    if (!res.ok) return;
    const data = await res.json();
    _domains = mergeDomainList(data?.domains);
    _domainListAt = Date.now();
    AsyncStorage?.setItem(STORAGE_DOMAIN_LIST_KEY, JSON.stringify({ at: _domainListAt, domains: _domains })).catch(() => {});
  } catch {
    // The saved or built-in list carries on.
  } finally {
    clearTimeout(timer);
  }
}

let _pinnedDomain: string = ANIMERULZ_DOMAINS[0];
let _hasVerifiedThisSession = false;
let _verificationPromise: Promise<string> | null = null;

// Eagerly hydrate last working domain from storage in the background without blocking execution
if (AsyncStorage) {
  try {
    AsyncStorage.getItem(STORAGE_DOMAIN_LIST_KEY)
      .then((raw: string | null) => {
        const saved = raw ? JSON.parse(raw) : null;
        if (saved?.domains) {
          _domains = mergeDomainList(saved.domains);
          _domainListAt = saved.at || 0;
        }
        return AsyncStorage.getItem(STORAGE_ACTIVE_DOMAIN_KEY);
      })
      .then((saved: string | null) => {
        if (saved && _domains.includes(saved)) {
          _pinnedDomain = saved;
        }
      })
      .catch(() => {});
  } catch {}
}

// In-memory stream cache and AniList ID lookup cache
const _streamCache = new Map<string, { ts: number; data: StreamData }>();
const _anilistIdCache = new Map<string, number>();
const CACHE_TTL = 90 * 60 * 1000; // links last 2 hours; isStreamUrlExpired guards the end
// Links are kept on the phone too, so Continue Watching skips the lookup after a restart.
const STORAGE_LINKS_KEY = '@animeverse:stream_links';
const SAVED_LINKS = 40;
const stillGood = (entry: { ts: number; data: StreamData }) => Date.now() - entry.ts < CACHE_TTL && !isStreamUrlExpired(entry.data?.streamUrl);
if (AsyncStorage) {
  try {
    AsyncStorage.getItem(STORAGE_LINKS_KEY)
      .then((raw: string | null) => {
        const saved: Array<[string, { ts: number; data: StreamData }]> = raw ? JSON.parse(raw) : [];
        for (const [key, entry] of saved) if (entry?.data?.streamUrl && stillGood(entry) && !_streamCache.has(key)) _streamCache.set(key, entry);
      })
      .catch(() => {});
  } catch {}
}
function saveLinks() {
  const fresh = [..._streamCache.entries()].filter(([, entry]) => stillGood(entry)).slice(-SAVED_LINKS);
  AsyncStorage?.setItem(STORAGE_LINKS_KEY, JSON.stringify(fresh)).catch(() => {});
}

// Episodes this server has no playable copy of: not asked again for a while.
const _missingEpisodes = new Map<string, number>();
const MISSING_TTL = 30 * 60 * 1000;
export function mainLacksEpisode(anilistId: number | null | undefined, episode: number): boolean {
  const at = _missingEpisodes.get(`${anilistId}:${episode}`);
  return at != null && Date.now() - at < MISSING_TTL;
}

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
 * Fast Domain Resolution & Background Health Check:
 * 1. Optimistic return: immediately returns pinned domain (defaulting to primary domain)
 *    so stream requests are never stalled behind a 3.5s health ping.
 * 2. Asynchronously verifies the domain in the background once per session.
 * 3. On force=true or hard failure, probes mirrors and updates the pinned domain.
 */
async function checkDomainHealth(domain: string): Promise<boolean> {
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
}

async function verifyActiveDomainInBackground(): Promise<string> {
  if (_verificationPromise) {
    return _verificationPromise;
  }

  _verificationPromise = (async () => {
    await refreshDomainList();
    let saved: string | null = null;
    try {
      if (AsyncStorage) {
        saved = await AsyncStorage.getItem(STORAGE_ACTIVE_DOMAIN_KEY);
      }
    } catch {}

    // 1. Test current pinned domain or saved domain first
    const primary = saved && _domains.includes(saved) ? saved : _pinnedDomain;
    const ok = await checkDomainHealth(primary);
    if (ok) {
      _pinnedDomain = primary;
      _hasVerifiedThisSession = true;
      return primary;
    }

    // 2. Fall back to testing all known mirrors
    for (const domain of _domains) {
      if (domain === primary) continue;
      const mirrorOk = await checkDomainHealth(domain);
      if (mirrorOk) {
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
    const defaultDomain = _domains[0];
    _pinnedDomain = defaultDomain;
    _hasVerifiedThisSession = true;
    return defaultDomain;
  })().finally(() => {
    _verificationPromise = null;
  });

  return _verificationPromise;
}

export async function getOrVerifyActiveDomain(force = false): Promise<string> {
  if (force) {
    return verifyActiveDomainInBackground();
  }

  // Optimistic fast path: return pinned domain immediately without blocking
  const domain = _pinnedDomain || _domains[0];
  if (!_hasVerifiedThisSession && !_verificationPromise) {
    verifyActiveDomainInBackground().catch(() => {});
  }
  return domain;
}

/**
 * Resolves Multi-Audio stream for the given anime and episode.
 */
const _inflight = new Map<string, Promise<StreamData>>();
let _lastRecheck = 0;

export function resolveAnimeRulzDirect(
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
  // One lookup at a time per episode: a second caller shares the first one's answer.
  const key = `${params.anilistId || params.id || params.title}:${params.episode}:${forceRefresh ? 'f' : ''}`;
  const running = _inflight.get(key);
  if (running) return running;
  const p = resolveAnimeRulzOnce(params, forceRefresh).finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

async function resolveAnimeRulzOnce(
  params: Parameters<typeof resolveAnimeRulzDirect>[0],
  forceRefresh: boolean,
): Promise<StreamData> {
  const domain = await getOrVerifyActiveDomain();
  let anilistId = params.anilistId;
  if ((!anilistId || anilistId <= 0) && params.id) {
    if (typeof params.id === 'number' && params.id > 0) {
      anilistId = params.id;
    } else if (typeof params.id === 'string') {
      // Only "al123" ids are AniList's; a plain number is a MyAnimeList id.
      if (params.id.startsWith('al')) {
        const parsed = parseInt(params.id.slice(2), 10);
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
    throw Object.assign(new Error('AnimeRulz requires a valid positive anilistId'), { kind: 'missing' });
  }

  const cacheKey = `${anilistId}:${params.episode}`.toLowerCase();
  const notHere = () => {
    _missingEpisodes.set(cacheKey, Date.now());
    return Object.assign(new Error("This episode isn't on the main server"), { kind: 'missing' });
  };
  if (!forceRefresh && mainLacksEpisode(anilistId, params.episode)) throw notHere();
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

  // A clear no is believed at once (the episode isn't here, or the server refused).
  // Only a lost connection or a server error gets one more try.
  let streamRes: any = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2 && !streamRes; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${domain}/api/reanime/stream?anilist_id=${anilistId}&episode=${ep}`, {
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
        const kind = res.status === 404 || res.status >= 500 ? 'connection' : 'refused';
        throw Object.assign(new Error(`HTTP ${res.status}`), { kind });
      }
      streamRes = await res.json();
    } catch (e) {
      lastError = e;
      console.log(`[Stream] main server, ep ${ep}, try ${attempt}: ${e instanceof Error ? e.message : String(e)}`);
      if ((e as { kind?: string }).kind === 'missing' || (e as { kind?: string }).kind === 'refused') break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
    } finally {
      clearTimeout(timer);
    }
  }
  if (!streamRes) {
    // Perhaps the site has moved: check the addresses, at most once a minute.
    if (Date.now() - _lastRecheck > 60000) {
      _lastRecheck = Date.now();
      getOrVerifyActiveDomain(true).catch(() => {});
    }
    throw lastError instanceof Error ? lastError : new Error('No answer');
  }

  const servers: any[] = Array.isArray(streamRes?.servers) ? streamRes.servers.filter(Boolean) : [];
  if (!servers.length) throw notHere();

  // What this episode has, as this server lists it.
  const modes = (['sub', 'dub'] as const).filter((m) => servers.some((s) => s.dataType === m));

  // The server the app can play: the multi-audio one. Many episodes (often new
  // shows) only have the other kinds listed, and that's simply not playable here.
  const multiServer = servers.find((s) => /ravok\.buzz/.test(String(s.dataLink))) || servers.find((s) => /\.m3u8/i.test(String(s.dataLink)));
  const dataLink = multiServer?.dataLink;
  if (!dataLink) throw notHere();

  let masterM3u8: string | null = null;
  let subtitles: SubtitleTrack[] = [];
  let referer = `${domain}/`;
  let videoRequestFailed = false;

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
            if (masterM3u8) break;
          }
          if (!postRes?.ok) videoRequestFailed = true;
          console.log(`[Stream] main server gave no video link (ep ${ep}, try ${attempt}, HTTP ${postRes?.status})`);
        } catch (e) {
          // Attempt failed, back off and retry once
          videoRequestFailed = true;
          console.log(`[Stream] video link request failed (ep ${ep}, try ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
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
    if (!videoRequestFailed) throw notHere();
    throw new Error('The main server gave no video link');
  }

  // Construct audio tracks based on server metadata without blocking JS-level manifest fetch.
  // ExoPlayer parses all in-band audio renditions dynamically at 60 FPS on the native thread.
  const isMultiAudio =
    dataLink.includes('ravok.buzz') ||
    multiServer?.dataType === 'indian' ||
    String(multiServer?.serverName || '').toLowerCase().includes('multi') ||
    String(multiServer?.serverName || '').toLowerCase().includes('hindi');

  const audioTracks: StreamAudioTrack[] = isMultiAudio
    ? [
        {
          id: 'hls-audio-0',
          name: 'Japanese',
          language: 'jpn',
          groupId: 'audio',
          uri: null,
          isDefault: false,
          isAutoselect: true,
          channels: null,
        },
        {
          id: 'hls-audio-1',
          name: 'Hindi',
          language: 'hin',
          groupId: 'audio',
          uri: null,
          isDefault: true,
          isAutoselect: true,
          channels: null,
        },
      ]
    : [
        {
          id: 'hls-audio-0',
          name: 'Default',
          language: 'und',
          groupId: 'audio',
          uri: null,
          isDefault: true,
          isAutoselect: true,
          channels: null,
        },
      ];

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
    modes,
  };

  _missingEpisodes.delete(cacheKey);
  _streamCache.set(cacheKey, { ts: Date.now(), data: result });
  saveLinks();
  return result;
}