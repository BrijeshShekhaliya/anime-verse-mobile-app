const express = require('express');
const router = express.Router();
const provider = require('../providers');
const cache = require('../services/cache');
const { inBackground } = require('../services/priority');
const imdb = require('../services/imdb');
const dubs = require('../services/dubs');
const tmdb = require('../services/tmdb');
const artwork = require('../services/artwork');
const hianime = require('../services/hianime');
const streamProxy = require('../services/streamProxy');

const TTL = {
  home: 30 * 60, // home rows refresh on their own every 30 minutes
  detail: 6 * 60 * 60,
  search: 15 * 60,
  schedule: 60 * 60,
  genres: 24 * 60 * 60,
};

const KEEP = {
  detail: 7 * 24 * 60 * 60,
  search: 24 * 60 * 60,
  schedule: 24 * 60 * 60,
  genres: 7 * 24 * 60 * 60,
};

// Serve-stale-while-refreshing: a visitor gets the last good answer instantly and
// never an error page just because an API is having a bad minute.
const fresh = (key, ttl, keep, loader) => cache.getFresh(key, ttl, keep, loader);
// A page served before all its TMDB posters arrived is refreshed on the next
// read (by then the posters are cached, so that refresh is quick).
const searchKey = (p) => `search:${JSON.stringify(p)}`;
const loadSearch = (p) =>
  fresh(searchKey(p), TTL.search, KEEP.search, () => provider.search(p)).then((r) => {
    if (r.postersPending) cache.markStale(searchKey(p));
    return r;
  });
const DEFAULT_BROWSE = { q: '', genre: '', type: '', status: '', order: '', dub: '', page: 1 };

const getDetail = (id) => fresh(`detail:${id}`, TTL.detail, KEEP.detail, () => provider.detail(id));

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function handle(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      console.error(`[api] ${req.originalUrl}: ${err.message}`);
      res.status(err.status === 404 ? 404 : 502).json({ error: 'Anime data is temporarily unavailable. Please try again shortly.' });
    }
  };
}

// Runs the loaders one after another (both APIs are rate limited) and keeps
// whatever succeeded so one failing row never blanks the home page.
async function settle(entries) {
  const out = {};
  for (const [key, loader] of entries) {
    try {
      out[key] = await loader();
    } catch (err) {
      console.warn(`[home] ${key} failed: ${err.message}`);
      out[key] = [];
    }
  }
  return out;
}

async function buildHome() {
  const rows = await settle([
    ['trending', () => provider.trending(20)],
    ['seasonNow', () => provider.seasonNow(24)],
    ['topRated', () => provider.topRated(20)],
    ['popular', () => provider.popular(20)],
    ['upcoming', () => provider.upcoming(20)],
    ['movies', () => provider.movies(20)],
  ]);
  if (!Object.values(rows).some((r) => r.length)) throw new Error('All home rows failed');
  // Spotlight uses TMDB's backdrops and title logos.
  const candidates = [...rows.trending, ...rows.seasonNow]
    .filter((a, i, arr) => a.synopsis && arr.findIndex((b) => b.id === a.id) === i)
    .slice(0, 14);
  const spotlight = (await artwork.withArtwork(candidates))
    .filter((a) => a.backdrop || a.banner)
    .sort((a, b) => Boolean(b.backdrop) - Boolean(a.backdrop))
    .slice(0, 8);
  const partial = Object.values(rows).some((r) => !r.length);
  const home = { spotlight, ...rows, partial, updatedAt: new Date().toISOString() };
  if (partial) {
    // A row that failed (rate limit, outage) is retried in 2 minutes, not 30.
    setTimeout(() => inBackground(() => cache.load('home', TTL.home, buildHome, HOME_KEEP)).catch(() => {}), 120 * 1000).unref();
  } else {
    cache.snapshot.write('home', home);
  }
  return home;
}

// Visitors always get the home page instantly once it has been built once:
// it refreshes in the background every 30 minutes and is kept for a day.
const HOME_KEEP = 24 * 60 * 60;
const getHome = () => cache.getFresh('home', TTL.home, HOME_KEEP, buildHome);

// Called at startup: serve the last saved page right away, then rebuild it.
function warmUp() {
  const saved = cache.snapshot.read('home');
  if (saved) cache.seed('home', saved, HOME_KEEP);
  inBackground(() =>
    getHome()
      .catch((err) => console.warn(`[home] warm-up failed: ${err.message}`))
      // The first Browse page is the other page nearly everyone opens.
      .then(() => loadSearch(DEFAULT_BROWSE))
      .catch((err) => console.warn(`[browse] warm-up failed: ${err.message}`))
  );
}

router.get('/home', handle(() => getHome()));

router.get(
  '/anime/:id',
  handle(async (req) => {
    const id = req.params.id;
    if (!/^(al)?\d+$/.test(id)) {
      const err = new Error('Bad id');
      err.status = 404;
      throw err;
    }
    const anime = await getDetail(id);
    const [imdbRating, art] = await Promise.all([
      imdb.enabled() ? imdb.lookup([anime.title, anime.titleRomaji], anime.year).catch(() => null) : null,
      artwork.artworkFor(anime),
    ]);
    const visuals = art || {};
    if (art && (artwork.isSeasonEntry(anime.title) || !artwork.SERIES_TYPES.has(anime.type) && art.tmdbKind === 'tv')) {
      // Keep the shared banner/logo, drop series-wide totals and poster.
      return { ...anime, ...visuals, tmdbPoster: null, seasonCount: null, episodeCount: null, tmdbStatus: null, imdb: imdbRating };
    }
    return { ...anime, ...visuals, ...(art ? artwork.seriesFacts(art, anime) : {}), imdb: imdbRating };
  })
);

router.get(
  '/anime/:id/extras',
  handle(async (req) => {
    const id = req.params.id;
    // A failure is not cached as "no cast", so the next visit tries again.
    return fresh(`extras:${id}`, TTL.detail, KEEP.detail, () => provider.extras(id));
  })
);

router.get(
  '/anime/:id/episodes',
  handle(async (req) => {
    const id = req.params.id;
    const anime = await getDetail(id);
    const detectedSeason = artwork.detectSeasonNumber ? artwork.detectSeasonNumber(anime.title, anime.titleRomaji) : 1;
    const season = Math.max(1, parseInt(req.query.season, 10) || detectedSeason || 1);
    const isAiring = !!anime.airing;
    const cacheTtl = isAiring ? 15 * 60 : TTL.detail; // 15 mins for airing titles to reflect newly released & dubbed episodes

    const cacheKey = `episodes:${id}:s${season}`;
    if (req.query.refresh === '1') {
      cache.store?.delete(cacheKey);
    }

    return cache.getOrSet(cacheKey, cacheTtl, async () => {
      const art = await artwork.artworkFor(anime);
      const tmdbShowId = art?.tmdbKind === 'tv' ? art.tmdbId : (await tmdb.findTmdbShow(anime.title, anime.titleRomaji, anime.year))?.id;
      let result = null;
      if (tmdbShowId) {
        const tmdbData = await tmdb.getTmdbShowData(tmdbShowId, season, anime);
        if (tmdbData && tmdbData.episodes.length > 0) {
          result = tmdbData;
        }
      }

      // Fallback: build structured episode list from anime detail
      if (!result) {
        let totalEp = anime.episodes && Number(anime.episodes) > 0 ? Number(anime.episodes) : (anime.type === 'Movie' ? 1 : 12);
        if (anime.airing || anime.status === 'Currently Airing' || anime.status === 'Releasing') {
          const nextEp = anime.nextEpisode?.episode ? Number(anime.nextEpisode.episode) : 0;
          if (nextEp > 1) {
            totalEp = Math.min(totalEp, nextEp - 1);
          }
        } else if (anime.status === 'Not yet aired' || anime.status === 'NOT_YET_RELEASED') {
          totalEp = 0;
        }

        const fallbackEpisodes = [];
        for (let i = 1; i <= totalEp; i++) {
          fallbackEpisodes.push({
            episode_number: i,
            season_number: season,
            name: `Episode ${i}`,
            overview: anime.synopsis ? (anime.synopsis.slice(0, 160) + '…') : '',
            still_path: anime.banner || anime.image,
            air_date: anime.aired || null,
            runtime: anime.duration ? parseInt(anime.duration, 10) : 24,
          });
        }

        result = {
          tmdbId: null,
          showName: anime.title,
          backdrop: anime.banner || null,
          seasons: [{ season_number: season, name: `Season ${season}`, episode_count: totalEp }],
          selectedSeason: season,
          episodes: fallbackEpisodes,
        };
      }

      // Fetch live HiAnime sub and dub availability
      let hianimeInfo = null;
      try {
        hianimeInfo = await hianime.getHiAnimeDubInfo({
          title: anime.title,
          romaji: anime.titleRomaji,
          season,
        });
      } catch (e) {
        console.warn('[episodes] HiAnime dub info fetch error:', e.message);
      }

      const dubCount = hianimeInfo?.dubCount ?? (anime.languages?.dub === 'full' ? result.episodes.length : (anime.languages?.dub === 'partial' ? 1 : 0));
      const subCount = hianimeInfo?.subCount ?? result.episodes.length;

      // Annotate each episode with hasDub and hasSub flags (Crunchyroll style)
      result.episodes.forEach((ep) => {
        ep.hasDub = dubCount > 0 && ep.episode_number <= dubCount;
        ep.hasSub = subCount > 0 ? (ep.episode_number <= subCount) : true;
      });

      result.dubCount = dubCount;
      result.subCount = subCount;

      return result;
    });
  })
);

router.get(
  '/stream/resolve',
  handle(async (req) => {
    const title = (req.query.title || '').trim();
    if (!title) {
      const err = new Error('Missing title');
      err.status = 400;
      throw err;
    }
    const romaji = (req.query.romaji || '').trim();
    const season = Math.max(1, parseInt(req.query.season, 10) || 1);
    const episode = Math.max(1, parseInt(req.query.episode, 10) || 1);
    const mode = req.query.mode === 'dub' ? 'dub' : 'sub';

    const cacheKey = `stream:${title}:${season}:${episode}:${mode}`;
    return cache.getOrSet(cacheKey, 60 * 60, async () => {
      const resolved = await hianime.resolveStream({ title, romaji, season, episode, mode });
      const ref = resolved.referer || 'https://zokoanime.video/';
      const proxiedMaster = `/api/stream/proxy?url=${encodeURIComponent(resolved.masterUrl)}&ref=${encodeURIComponent(ref)}`;
      const proxiedSubs = (resolved.subtitles || []).map((s) => ({
        ...s,
        src: `/api/stream/proxy?url=${encodeURIComponent(s.src)}&ref=${encodeURIComponent(ref)}`,
      }));

      return {
        success: true,
        source: 'HiAnime (Native)',
        mode: resolved.mode,
        seasonNumber: resolved.seasonNumber,
        episodeNumber: resolved.episodeNumber,
        streamUrl: proxiedMaster,
        rawMasterUrl: resolved.masterUrl,
        referer: ref,
        subtitles: proxiedSubs,
      };
    });
  })
);

router.get('/stream/proxy', (req, res) => {
  return streamProxy.handleProxy(req, res);
});

router.get(
  '/search',
  handle((req) => {
    const params = {
      q: (req.query.q || '').toString().slice(0, 100).trim(),
      genre: (req.query.genre || '').toString(),
      type: (req.query.type || '').toString(),
      status: (req.query.status || '').toString(),
      order: (req.query.order || '').toString(),
      dub: req.query.dub === '1' ? '1' : '',
      page: Math.max(1, Math.min(200, parseInt(req.query.page, 10) || 1)),
    };
    return loadSearch(params);
  })
);

router.get(
  '/schedule/:day',
  handle((req) => {
    const day = req.params.day.toLowerCase();
    if (!DAYS.includes(day)) {
      const err = new Error('Bad day');
      err.status = 404;
      throw err;
    }
    return fresh(`schedule:${day}`, TTL.schedule, KEEP.schedule, () => provider.schedule(day));
  })
);

router.get(
  '/genres',
  handle(() => fresh('genres', TTL.genres, KEEP.genres, () => provider.genres()))
);

router.get('/status', (req, res) => {
  res.json({
    provider: provider.status(),
    dubs: dubs.status(),
    imdb: imdb.enabled() ? 'enabled' : 'disabled (set OMDB_API_KEY)',
    uptime: process.uptime(),
  });
});

module.exports = router;
module.exports.warmUp = warmUp;
