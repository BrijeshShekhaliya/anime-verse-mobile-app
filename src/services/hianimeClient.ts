// ── Client-Side HiAnime (hianime.at) Stream Resolver ─────────────────────────
// Self-contained, zero-backend stream resolver ported from Streambert / ani-cli.
// Executes directly on the mobile device (pure JS/Hermes) without passing
// through an intermediary proxy server.
//
// Pipeline:
//   1. AniList GraphQL sequel title resolution for Season 2+
//   2. GET /search?keyword=... -> scrape show slug and numeric ID
//   3. GET /api/theme/episode/list/{numericId} -> scrape episode ID
//   4. GET /api/theme/episode/servers?episodeId=... -> scrape ZokoAnime data-hash
//   5. Base64 decode -> embed URL -> fetch embed page
//   6. Extract window.__P blob -> XOR de-obfuscate with 'otaku-embed-v1'
//   7. Fetch master.m3u8 -> parse ALL in-band audio tracks (Hindi, English, etc.)
//   8. Return StreamData with direct CDN URLs, referer, subtitles, and audio tracks

import type { StreamAudioTrack, StreamData, SubtitleTrack } from '@/lib/types';

const BASE_URL = 'https://hianime.at';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const OBFUSCATION_KEY = 'otaku-embed-v1';

// In-memory cache for the session so repeated searches or episode switches are instantaneous
const _searchCache = new Map<string, { ts: number; data: Array<{ id: string; title: string; jname?: string | null }> }>();
const _episodesCache = new Map<string, { ts: number; data: Array<{ epId: string; number: number }> }>();
const _streamCache = new Map<string, { ts: number; data: StreamData }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 mins

async function fetchWithTimeout(url: string, referer?: string, timeoutMs = 9000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
    };
    if (referer) headers['Referer'] = referer;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function unwrapApiHtml(body: string): string {
  let text = body;
  try {
    const json = JSON.parse(body);
    const parts: string[] = [];
    const walk = (v: any) => {
      if (typeof v === 'string') parts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(json);
    if (parts.length) text = parts.join('\n');
  } catch {}
  return text.replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\\/g, '');
}

function getAttr(tagText: string, name: string): string | null {
  const m = tagText.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function deobfuscateBlob(blobBase64: string): string {
  const binary = atob(blobBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length);
  }
  return new TextDecoder().decode(bytes);
}

// Parse all in-band audio renditions from the master playlist (Japanese, English, Hindi, Tamil, etc.)
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

// ── AniList Sequel Resolution ───────────────────────────────────────────────
export async function anilistSeasonTitle(
  baseTitle: string,
  seasonNumber: number,
): Promise<{ title: string; romaji?: string | null }> {
  if (seasonNumber <= 1) return { title: baseTitle, romaji: null };
  try {
    const query = `query($search:String){Media(search:$search,type:ANIME,sort:SEARCH_MATCH){title{english romaji}episodes relations{edges{relationType node{type format title{english romaji}episodes startDate{year}seasonYear}}}}}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { search: baseTitle } }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return { title: baseTitle, romaji: null };
    const json = await res.json();
    const media = json?.data?.Media;
    if (!media) return { title: baseTitle, romaji: null };

    const sequels = (media.relations?.edges || [])
      .filter(
        (e: any) =>
          e.relationType === 'SEQUEL' &&
          e.node?.type === 'ANIME' &&
          (e.node?.format === 'TV' || e.node?.format === 'TV_SHORT'),
      )
      .sort((a: any, b: any) => {
        const ya = a.node.startDate?.year || a.node.seasonYear || 9999;
        const yb = b.node.startDate?.year || b.node.seasonYear || 9999;
        return ya - yb;
      });

    const target = sequels[seasonNumber - 2];
    if (!target) return { title: baseTitle, romaji: media.title?.romaji || null };

    return {
      title: target.node.title?.english || target.node.title?.romaji || baseTitle,
      romaji: target.node.title?.romaji || null,
    };
  } catch {
    return { title: baseTitle, romaji: null };
  }
}

// ── Scrape Show Search ──────────────────────────────────────────────────────
export async function hianimeSearch(query: string) {
  const cacheKey = query.toLowerCase().trim();
  const hit = _searchCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const q = encodeURIComponent(query).replace(/%20/g, '+');
  const html = await fetchWithTimeout(`${BASE_URL}/search?keyword=${q}`, undefined, 8000);
  const main = html.split('id="main-sidebar"')[0];
  const results: Array<{ id: string; title: string; jname?: string | null }> = [];
  const re = /<h3 class="film-name">([\s\S]*?)<\/h3>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(main))) {
    const anchor = m[1].match(/<a\s+([^>]*)>/);
    if (!anchor) continue;
    const href = getAttr(anchor[1], 'href');
    const title = getAttr(anchor[1], 'title');
    if (!href || !title) continue;
    const id = href.split('?')[0].replace(/\/+$/, '').split('/').pop();
    if (!id) continue;
    const jname = getAttr(anchor[1], 'data-jname');
    results.push({
      id,
      title: decodeEntities(title),
      jname: jname ? decodeEntities(jname) : null,
    });
  }

  _searchCache.set(cacheKey, { ts: Date.now(), data: results });
  return results;
}

// ── Scrape Episode List ─────────────────────────────────────────────────────
export async function hianimeEpisodes(showId: string): Promise<Array<{ epId: string; number: number }>> {
  const hit = _episodesCache.get(showId);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const numericId = showId.slice(showId.lastIndexOf('-') + 1);
  if (!/^\d+$/.test(numericId)) throw new Error('Invalid show id: ' + showId);

  const body = await fetchWithTimeout(`${BASE_URL}/api/theme/episode/list/${numericId}`, `${BASE_URL}/`, 8000);
  const html = unwrapApiHtml(body);
  const episodes: Array<{ epId: string; number: number }> = [];

  for (const chunk of html.split('ep-item').slice(1)) {
    const number = getAttr(chunk, 'data-number');
    const epId = getAttr(chunk, 'data-id');
    if (!number || !epId || !/^\d+$/.test(epId)) continue;
    if (!chunk.includes(`/watch/${showId}?ep=`)) continue;
    episodes.push({ epId, number: parseInt(number, 10) });
  }

  _episodesCache.set(showId, { ts: Date.now(), data: episodes });
  return episodes;
}

// ── High-Level Direct HiAnime Resolver ──────────────────────────────────────
export async function resolveHiAnimeDirect(
  params: {
    title: string;
    romaji?: string;
    season: number;
    episode: number;
    mode: 'sub' | 'dub';
  },
  forceRefresh = false,
): Promise<StreamData> {
  const cacheKey = `${params.title}:${params.season}:${params.episode}:${params.mode}`.toLowerCase();
  if (!forceRefresh) {
    const hit = _streamCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  }

  // 1. Resolve franchise sequel title for S2+
  const anilistInfo = await anilistSeasonTitle(params.title, params.season);
  const searchCandidates = [
    anilistInfo.title,
    anilistInfo.romaji,
    params.title,
    params.romaji,
  ].filter(Boolean) as string[];

  // 2. Find show matching candidate title
  let show: { id: string; title: string; jname?: string | null } | null = null;
  for (const candidate of searchCandidates) {
    try {
      const results = await hianimeSearch(candidate);
      if (results.length > 0) {
        show = results[0];
        break;
      }
    } catch {}
  }

  if (!show) {
    throw new Error(`Show not found on HiAnime for "${params.title}"`);
  }

  // 3. Get episode list and locate requested episode
  const episodes = await hianimeEpisodes(show.id);
  if (!episodes.length) {
    throw new Error(`No episodes found for show: ${show.title}`);
  }

  const episode =
    episodes.find((e) => e.number === params.episode) ||
    episodes.find((e) => Number(e.number) === Number(params.episode));

  if (!episode) {
    throw new Error(`Episode ${params.episode} not found for ${show.title}`);
  }

  // 4. Fetch available stream servers for this episode
  const servBody = await fetchWithTimeout(
    `${BASE_URL}/api/theme/episode/servers?episodeId=${episode.epId}`,
    `${BASE_URL}/`,
    8000,
  );
  const servHtml = unwrapApiHtml(servBody);

  let targetHash: string | null = null;
  // Prefer ZokoAnime server first
  for (const chunk of servHtml.split('server-item').slice(1)) {
    if (getAttr(chunk, 'data-type') === params.mode && getAttr(chunk, 'data-server-name') === 'ZokoAnime') {
      targetHash = getAttr(chunk, 'data-hash');
      if (targetHash) break;
    }
  }
  // Fall back to any server for the requested mode
  if (!targetHash) {
    for (const chunk of servHtml.split('server-item').slice(1)) {
      if (getAttr(chunk, 'data-type') === params.mode) {
        targetHash = getAttr(chunk, 'data-hash');
        if (targetHash) break;
      }
    }
  }

  if (!targetHash) {
    throw new Error(`No compatible stream server found for mode: ${params.mode}`);
  }

  // 5. De-obfuscate embed URL
  const embedUrl = atob(targetHash).trim();
  if (!/^https?:\/\//i.test(embedUrl)) throw new Error('Invalid embed URL');
  const referer = embedUrl.replace(/^(https?:\/\/[^/]*).*$/, '$1/');

  // 6. Fetch embed page and extract encrypted blob
  const embedHtml = await fetchWithTimeout(embedUrl, `${BASE_URL}/`, 8000);
  const blobMatch = embedHtml.match(/window\.__P="([^"]*)"/);
  if (!blobMatch) throw new Error('Embed config (window.__P) not found');

  // 7. XOR decrypt stream configuration
  const decryptedJson = deobfuscateBlob(blobMatch[1]);
  const cfg = JSON.parse(decryptedJson);
  let masterUrl = cfg.src;
  if (!masterUrl && Array.isArray(cfg.sources)) {
    const found = cfg.sources.find((s: any) => s && s.file && /\.m3u8/i.test(s.file));
    if (found) masterUrl = found.file;
  }

  if (!masterUrl) {
    throw new Error('No master.m3u8 stream found in decrypted embed config');
  }

  masterUrl = String(masterUrl).replace(/\\\//g, '/');

  // 8. Parse subtitles
  const subtitles: SubtitleTrack[] = (cfg.subtitles || [])
    .filter((s: any) => s && s.src)
    .map((s: any) => ({
      lang: s.lang || 'en',
      label: s.label || s.lang || 'Subtitles',
      src: String(s.src).replace(/\\\//g, '/'),
      default: Boolean(s.default),
    }));

  // 9. Fetch master manifest directly to extract ALL audio tracks (Hindi, English, etc.)
  let audioTracks: StreamAudioTrack[] = [];
  try {
    const masterManifest = await fetchWithTimeout(masterUrl, referer, 7000);
    audioTracks = parseHlsAudioTracks(masterManifest, masterUrl);
  } catch (err: any) {
    console.warn('[hianimeClient] Could not parse in-manifest audio tracks:', err?.message);
  }

  const result: StreamData = {
    success: true,
    source: 'AnimeVerse (Fast Stream)',
    mode: params.mode,
    seasonNumber: params.season,
    episodeNumber: params.episode,
    streamUrl: masterUrl,
    rawMasterUrl: masterUrl,
    referer,
    subtitles,
    audioTracks,
  };

  _streamCache.set(cacheKey, { ts: Date.now(), data: result });
  return result;
}
