// ── HiAnime (hianime.at) Stream Resolver ──────────────────────────────────────
// Inspired by Streambert / ani-cli:
//   1. AniList GraphQL sequel title resolution for Season 2+
//   2. GET /search?keyword=... -> scrape show slug
//   3. GET /api/theme/episode/list/{numericId} -> scrape episode ID
//   4. GET /api/theme/episode/servers?episodeId=... -> scrape ZokoAnime data-hash
//   5. Base64 decode -> embed URL -> fetch embed page
//   6. Extract window.__P blob -> XOR de-obfuscate with 'otaku-embed-v1'
//   7. Return master.m3u8 URL, subtitle tracks (.vtt), and embed referer

const https = require('https');
const http = require('http');
const netMod = require('net');
const dns = require('dns').promises;

const BASE_URL = 'https://hianime.at';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const OBFUSCATION_KEY = Buffer.from('otaku-embed-v1', 'utf8');
const SERVER_NAME = 'ZokoAnime';
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

// In-memory caches to prevent repeated scraping within a session
const _searchCache = new Map();
const _episodesCache = new Map();
const _streamCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 mins

function isPrivateIp(ip) {
  if (netMod.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (netMod.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      l === '::' ||
      l === '::1' ||
      l.startsWith('fc') ||
      l.startsWith('fd') ||
      /^fe[89ab]/.test(l)
    );
  }
  return true;
}

const _validatedHosts = new Map();

async function assertPublicUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('Invalid url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('Blocked protocol');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (netMod.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Blocked address');
    return u;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked address');
  }
  if (_validatedHosts.has(host)) {
    if (!_validatedHosts.get(host)) throw new Error('Blocked address');
    return u;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      _validatedHosts.set(host, false);
      throw new Error('Blocked address');
    }
    _validatedHosts.set(host, true);
    return u;
  } catch (err) {
    _validatedHosts.set(host, false);
    throw err;
  }
}

function curl(urlStr, { referer, accept } = {}, timeoutMs = 7000, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(new Error('Invalid url: ' + urlStr));
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept || '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
          ...(referer ? { Referer: referer } : {}),
        },
        agent: lib === https ? httpsAgent : httpAgent,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          hops < 8
        ) {
          res.resume();
          const loc = new URL(res.headers.location, urlStr).href;
          return resolve(curl(loc, { referer, accept }, timeoutMs, hops + 1));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_TEXT_BYTES) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function unwrapApiHtml(body) {
  let text = body;
  try {
    const json = JSON.parse(body);
    const parts = [];
    const walk = (v) => {
      if (typeof v === 'string') parts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(json);
    if (parts.length) text = parts.join('\n');
  } catch {}
  return text.replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\\/g, '');
}

function getAttr(tagText, name) {
  const m = tagText.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function deobfuscateBlob(blob) {
  const buf = Buffer.from(blob, 'base64');
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.length];
  }
  return out.toString('utf8');
}

// ── AniList Sequel Resolver ──────────────────────────────────────────────────
const _anilistTitleCache = new Map();

function anilistSeasonTitle(baseTitle, seasonNumber) {
  return new Promise((resolve) => {
    if (seasonNumber <= 1) return resolve({ title: baseTitle, romaji: null });
    const cacheKey = `${baseTitle.toLowerCase().trim()}:${seasonNumber}`;
    if (_anilistTitleCache.has(cacheKey)) return resolve(_anilistTitleCache.get(cacheKey));

    const query = `query($search:String){Media(search:$search,type:ANIME,sort:SEARCH_MATCH){title{english romaji}episodes relations{edges{relationType node{type format title{english romaji}episodes startDate{year}seasonYear}}}}}`;
    const body = JSON.stringify({ query, variables: { search: baseTitle } });
    const opts = {
      hostname: 'graphql.anilist.co',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': USER_AGENT,
      },
      agent: httpsAgent,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const media = json?.data?.Media;
          if (!media) {
            const fallback = { title: `${baseTitle} Season ${seasonNumber}` };
            _anilistTitleCache.set(cacheKey, fallback);
            return resolve(fallback);
          }

          const sequels = (media.relations?.edges || [])
            .filter(
              (e) =>
                e.relationType === 'SEQUEL' &&
                e.node.type === 'ANIME' &&
                (e.node.format === 'TV' || e.node.format === 'TV_SHORT')
            )
            .sort((a, b) => {
              const ya = a.node.startDate?.year || a.node.seasonYear || 9999;
              const yb = b.node.startDate?.year || b.node.seasonYear || 9999;
              return ya - yb;
            });

          const target = sequels[seasonNumber - 2];
          if (!target) {
            const fallback = { title: `${baseTitle} Season ${seasonNumber}` };
            _anilistTitleCache.set(cacheKey, fallback);
            return resolve(fallback);
          }
          const title = target.node.title?.english || target.node.title?.romaji || `${baseTitle} Season ${seasonNumber}`;
          const resObj = { title, romaji: target.node.title?.romaji || null };
          _anilistTitleCache.set(cacheKey, resObj);
          resolve(resObj);
        } catch {
          const fallback = { title: `${baseTitle} Season ${seasonNumber}` };
          _anilistTitleCache.set(cacheKey, fallback);
          resolve(fallback);
        }
      });
    });
    req.on('error', () => resolve({ title: `${baseTitle} Season ${seasonNumber}` }));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ title: `${baseTitle} Season ${seasonNumber}` });
    });
    req.write(body);
    req.end();
  });
}

// ── Search HiAnime ────────────────────────────────────────────────────────────
async function hianimeSearch(query) {
  const cacheKey = query.toLowerCase().trim();
  const hit = _searchCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const q = encodeURIComponent(query).replace(/%20/g, '+');
  const res = await curl(`${BASE_URL}/search?keyword=${q}`, { accept: 'text/html' });
  if (res.status !== 200) throw new Error(`HiAnime search failed: HTTP ${res.status}`);

  const main = res.body.split('id="main-sidebar"')[0];
  const results = [];
  const re = /<h3 class="film-name">([\s\S]*?)<\/h3>/g;
  let m;
  while ((m = re.exec(main))) {
    const anchor = m[1].match(/<a\s+([^>]*)>/);
    if (!anchor) continue;
    const href = getAttr(anchor[1], 'href');
    const title = getAttr(anchor[1], 'title');
    if (!href || !title) continue;
    const id = href.split('?')[0].replace(/\/+$/, '').split('/').pop();
    if (!id) continue;
    const jname = getAttr(anchor[1], 'data-jname');

    // Parse sub and dub counts from preceding card ticks (e.g. tick-sub 12, tick-dub 10)
    const cardBefore = main.slice(Math.max(0, m.index - 1200), m.index);
    const subM = cardBefore.match(/class="[^"]*tick-sub[^"]*"[^>]*>[\s\S]*?(\d+)<\/div>/i);
    const dubM = cardBefore.match(/class="[^"]*tick-dub[^"]*"[^>]*>[\s\S]*?(\d+)<\/div>/i);
    const subCount = subM ? parseInt(subM[1], 10) : 0;
    const dubCount = dubM ? parseInt(dubM[1], 10) : 0;

    results.push({
      id,
      title: decodeEntities(title),
      jname: jname ? decodeEntities(jname) : null,
      subCount,
      dubCount,
    });
  }
  _searchCache.set(cacheKey, { ts: Date.now(), data: results });
  return results;
}

// ── Scrape Episode List for Show ──────────────────────────────────────────────
async function hianimeEpisodes(showId) {
  const hit = _episodesCache.get(showId);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const numericId = showId.slice(showId.lastIndexOf('-') + 1);
  if (!/^\d+$/.test(numericId)) throw new Error('Invalid show id: ' + showId);

  const res = await curl(`${BASE_URL}/api/theme/episode/list/${numericId}`, {
    referer: BASE_URL + '/',
  });
  if (res.status !== 200) throw new Error(`HiAnime episodes failed: HTTP ${res.status}`);

  const html = unwrapApiHtml(res.body);
  const episodes = [];
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

// ── Scrape Stream for Episode ─────────────────────────────────────────────────
async function hianimeStream(epId, mode = 'sub') {
  const cacheKey = `${epId}:${mode}`;
  const hit = _streamCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const servRes = await curl(`${BASE_URL}/api/theme/episode/servers?episodeId=${epId}`, {
    referer: BASE_URL + '/',
  });
  if (servRes.status !== 200) throw new Error(`HiAnime server list failed: HTTP ${servRes.status}`);

  const html = unwrapApiHtml(servRes.body);

  let hash = null;
  for (const chunk of html.split('server-item').slice(1)) {
    const type = getAttr(chunk, 'data-type');
    const sname = getAttr(chunk, 'data-server-name');
    if (type === mode && sname === SERVER_NAME) {
      hash = getAttr(chunk, 'data-hash');
      if (hash) break;
    }
  }

  // Fallback to first available server for this mode if ZokoAnime is absent
  if (!hash) {
    for (const chunk of html.split('server-item').slice(1)) {
      if (getAttr(chunk, 'data-type') === mode) {
        hash = getAttr(chunk, 'data-hash');
        if (hash) break;
      }
    }
  }

  if (!hash) throw new Error(`No compatible stream server found for mode: ${mode}`);

  const embedUrl = Buffer.from(hash, 'base64').toString('utf8').trim();
  if (!/^https?:\/\//i.test(embedUrl)) throw new Error('Invalid embed url: ' + embedUrl);

  const referer = embedUrl.replace(/^(https?:\/\/[^/]*).*$/, '$1/');
  const embedRes = await curl(embedUrl);
  if (embedRes.status !== 200) throw new Error(`Failed to load embed page: HTTP ${embedRes.status}`);

  const blobMatch = embedRes.body.match(/window\.__P="([^"]*)"/);
  if (!blobMatch) throw new Error('Embed config (window.__P) not found');

  const jsonText = deobfuscateBlob(blobMatch[1]);
  let masterUrl = null;
  let subtitles = [];

  try {
    const cfg = JSON.parse(jsonText);
    const findM3u8 = (v) => {
      if (typeof v === 'string') return /\.m3u8/i.test(v) ? v : null;
      if (Array.isArray(v)) {
        for (const x of v) {
          const r = findM3u8(x);
          if (r) return r;
        }
      } else if (v && typeof v === 'object') {
        if (typeof v.src === 'string' && /\.m3u8/i.test(v.src)) return v.src;
        for (const x of Object.values(v)) {
          const r = findM3u8(x);
          if (r) return r;
        }
      }
      return null;
    };
    masterUrl = findM3u8(cfg);
    if (Array.isArray(cfg.subtitles)) {
      subtitles = cfg.subtitles
        .filter((s) => s && s.src)
        .map((s) => ({
          lang: s.lang || 'en',
          label: s.label || s.lang || 'Subtitles',
          src: s.src.replace(/\\\//g, '/'),
          default: Boolean(s.default),
        }));
    }
  } catch {
    const m = jsonText.match(/"src":"([^"]*\.m3u8[^"]*)"/);
    masterUrl = m ? m[1] : null;
  }

  if (!masterUrl) throw new Error('No master.m3u8 stream found in decrypted payload');
  masterUrl = masterUrl.replace(/\\\//g, '/');

  const data = { masterUrl, referer, subtitles, resolution: '1080p' };
  _streamCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

// ── High-Level Resolver ───────────────────────────────────────────────────────
// ── Get HiAnime Dub / Sub Availability for Anime Season ───────────────────────
async function getHiAnimeDubInfo({ title, romaji, season = 1 }) {
  const seasonNum = Math.max(1, parseInt(season, 10) || 1);
  let searchTitle = title;
  if (seasonNum > 1) {
    const ani = await anilistSeasonTitle(title, seasonNum).catch(() => null);
    if (ani && ani.title) searchTitle = ani.title;
    else searchTitle = `${title} Season ${seasonNum}`;
  }

  let results = await hianimeSearch(searchTitle);
  if (!results.length && romaji) {
    results = await hianimeSearch(romaji);
  }
  if (!results.length && seasonNum > 1) {
    results = await hianimeSearch(title);
  }
  if (!results.length) return null;

  const show = results[0];
  return {
    showId: show.id,
    showTitle: show.title,
    subCount: show.subCount || 0,
    dubCount: show.dubCount || 0,
  };
}

// Given anime title, season (1-based), episode (1-based), and mode ('sub'|'dub'),
// resolves the stream URL and subtitle tracks.
async function resolveStream({ title, romaji, season = 1, episode = 1, mode = 'sub' }) {
  const seasonNum = Math.max(1, parseInt(season, 10) || 1);
  const epNum = Math.max(1, parseInt(episode, 10) || 1);
  const playMode = mode === 'dub' ? 'dub' : 'sub';

  // 1. Resolve title for season
  let searchTitle = title;
  if (seasonNum > 1) {
    const ani = await anilistSeasonTitle(title, seasonNum).catch(() => null);
    if (ani && ani.title) searchTitle = ani.title;
    else searchTitle = `${title} Season ${seasonNum}`;
  }

  // 2. Search on HiAnime
  let results = await hianimeSearch(searchTitle);
  if (!results.length && romaji) {
    results = await hianimeSearch(romaji);
  }
  if (!results.length && seasonNum > 1) {
    // Try searching base title if specific season query had no results
    results = await hianimeSearch(title);
  }
  if (!results.length) {
    throw new Error(`Anime not found on HiAnime: "${searchTitle}"`);
  }

  // Find best matching show
  // For S1 or direct search, the first result or exact title match
  const show = results[0];
  const episodes = await hianimeEpisodes(show.id);
  if (!episodes.length) {
    throw new Error(`No episodes found for show: "${show.title}" (${show.id})`);
  }

  // Find target episode
  const targetEp = episodes.find((e) => e.number === epNum) || episodes[0];
  if (!targetEp) {
    throw new Error(`Episode ${epNum} not found for "${show.title}"`);
  }

  // 3. Resolve stream (graceful fallback from dub to sub if episode has no dub)
  let activeMode = playMode;
  let streamData;
  let fallbackFromDub = false;

  if (playMode === 'dub') {
    try {
      streamData = await hianimeStream(targetEp.epId, 'dub');
    } catch (err) {
      console.warn(`[hianime] Dub not available for ep ${epNum}, falling back to sub:`, err.message);
      streamData = await hianimeStream(targetEp.epId, 'sub');
      activeMode = 'sub';
      fallbackFromDub = true;
    }
  } else {
    streamData = await hianimeStream(targetEp.epId, 'sub');
  }

  return {
    showId: show.id,
    showTitle: show.title,
    epId: targetEp.epId,
    episodeNumber: targetEp.number,
    seasonNumber: seasonNum,
    mode: activeMode,
    fallbackFromDub,
    subCount: show.subCount || 0,
    dubCount: show.dubCount || 0,
    ...streamData,
  };
}

module.exports = {
  hianimeSearch,
  hianimeEpisodes,
  hianimeStream,
  resolveStream,
  getHiAnimeDubInfo,
  assertPublicUrl,
};
