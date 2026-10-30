// ── Client-Side AniList & Metadata Provider ─────────────────────────────────
// Standalone, zero-backend metadata client ported from stream-aggregator.
// Fetches anime rows, detail, cast, recommendations, search, genres, schedules,
// and episode listings directly on the mobile device (pure JS/Hermes) without
// routing through an intermediary AWS server.

import type {
  Anime,
  AnimeDetail,
  Character,
  Episode,
  EpisodesData,
  Home,
  Relation,
  SearchResult,
} from '@/lib/types';
import { anilistSeasonTitle, hianimeEpisodes, hianimeSearch } from './hianimeClient';

const ANILIST_URL = 'https://graphql.anilist.co';

export type SearchParams = {
  q?: string;
  genre?: string;
  type?: string;
  status?: string;
  order?: string;
  dub?: boolean;
  page?: number;
};

const MEDIA_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  description(asHtml: false)
  averageScore meanScore popularity favourites
  episodes status format season seasonYear duration
  genres
  studios(isMain: true) { nodes { name } }
  trailer { id site }
  startDate { year month day }
  endDate { year month day }
  nextAiringEpisode { episode airingAt }
  externalLinks { site url type }
  rankings { rank type allTime }
  isAdult
  family: relations { edges { relationType node { id type format episodes } } }
`;

const DETAIL_FIELDS = `
  ${MEDIA_FIELDS}
  synonyms source countryOfOrigin hashtag siteUrl favourites
  allStudios: studios { edges { isMain node { name isAnimationStudio } } }
  tags { name rank isMediaSpoiler }
  relations { edges { relationType node { id idMal type format status episodes seasonYear isAdult title { english romaji } coverImage { large } } } }
  stats { scoreDistribution { score amount } statusDistribution { status amount } }
`;

// AniList allows 90 requests/min; track rate limits and pause briefly if 429
let pausedUntil = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postQuery(body: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(ANILIST_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'AnimeVerse/1.0',
        },
        body,
      });
    } finally {
      clearTimeout(timer);
    }

    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 30;
      pausedUntil = Date.now() + Math.min(retryAfter, 65) * 1000;
      console.warn(`[anilist] rate limited; pausing ${Math.min(retryAfter, 65)}s`);
      continue;
    }

    if (Number.isFinite(remaining) && remaining <= 1 && reset) {
      pausedUntil = reset * 1000 + 500;
    }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${ANILIST_URL}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    if (json.errors?.length) {
      const err = new Error(json.errors[0].message) as Error & { status?: number };
      throw err;
    }
    return json.data;
  }

  const err = new Error('AniList rate limit') as Error & { status?: number };
  err.status = 429;
  throw err;
}

export function query(q: string, variables: Record<string, any> = {}): Promise<any> {
  return postQuery(JSON.stringify({ query: q, variables }));
}

const STATUS: Record<string, string> = {
  RELEASING: 'Currently Airing',
  FINISHED: 'Finished Airing',
  NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled',
  HIATUS: 'On Hiatus',
};

const FORMAT: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
};

const RELATION: Record<string, string> = {
  ADAPTATION: 'Adaptation',
  PREQUEL: 'Prequel',
  SEQUEL: 'Sequel',
  PARENT: 'Parent story',
  SIDE_STORY: 'Side story',
  CHARACTER: 'Shared characters',
  SUMMARY: 'Summary',
  ALTERNATIVE: 'Alternative version',
  SPIN_OFF: 'Spin-off',
  OTHER: 'Other',
  SOURCE: 'Source',
  COMPILATION: 'Compilation',
  CONTAINS: 'Contains',
};

const WATCH_STATUS: Record<string, string> = {
  CURRENT: 'Watching',
  PLANNING: 'Plan to watch',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
  PAUSED: 'On hold',
};

function cleanDescription(text?: string | null): string {
  return (text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/^\s*(\.{3}|…)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDate(d?: { year?: number; month?: number; day?: number } | null): string | null {
  if (!d?.year) return null;
  return new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: d.month ? 'short' : undefined,
    day: d.day ? 'numeric' : undefined,
  });
}

export function normalize(m: any): Anime {
  const rated = (m.rankings || []).find((r: any) => r.type === 'RATED' && r.allTime);
  const start = formatDate(m.startDate);
  const end = formatDate(m.endDate);
  const score = m.averageScore ? m.averageScore / 10 : m.meanScore ? m.meanScore / 10 : null;

  return {
    id: m.idMal ? String(m.idMal) : `al${m.id}`,
    malId: m.idMal || null,
    anilistId: m.id ? Number(m.id) : null,
    title: m.title?.english || m.title?.romaji || 'Unknown',
    titleRomaji: m.title?.romaji || null,
    titleJapanese: m.title?.native || null,
    image: m.coverImage?.large || m.coverImage?.extraLarge || null,
    image2x: m.coverImage?.extraLarge || null,
    banner: m.bannerImage || null,
    synopsis: cleanDescription(m.description),
    score: score ? Math.round(score * 10) / 10 : null,
    scoredBy: null,
    rank: rated?.rank || null,
    members: m.popularity || null,
    episodes: m.episodes || null,
    status: STATUS[m.status] || m.status || null,
    airing: m.status === 'RELEASING',
    type: FORMAT[m.format] || m.format || null,
    season: m.season ? m.season.toLowerCase() : null,
    year: m.seasonYear || m.startDate?.year || null,
    genres: m.genres || [],
    studios: (m.studios?.nodes || []).map((s: any) => s.name),
    duration: m.duration ? `${m.duration} min per ep` : null,
    trailer: m.trailer?.site === 'youtube' ? m.trailer.id : null,
    nextEpisode: m.nextAiringEpisode ? { episode: m.nextAiringEpisode.episode, airingAt: m.nextAiringEpisode.airingAt } : null,
    source: 'anilist',
  };
}

export function normalizeDetail(m: any): AnimeDetail {
  const base = normalize(m);
  const studioEdges = m.allStudios?.edges || [];

  const relations: Relation[] = (m.relations?.edges || [])
    .filter((e: any) => !e.node?.isAdult)
    .map((e: any) => ({
      relation: RELATION[e.relationType] || e.relationType,
      id: e.node.type === 'ANIME' ? (e.node.idMal ? String(e.node.idMal) : `al${e.node.id}`) : null,
      kind: e.node.type === 'ANIME' ? 'anime' : 'manga',
      title: e.node.title?.english || e.node.title?.romaji || 'Unknown',
      image: e.node.coverImage?.large || null,
      format: FORMAT[e.node.format] || e.node.format || null,
      year: e.node.seasonYear || null,
    }));

  return {
    ...base,
    image: m.coverImage?.extraLarge || m.coverImage?.large || base.image,
    studios: studioEdges.filter((e: any) => e.isMain).map((e: any) => e.node.name),
    relations,
    links: (m.externalLinks || []).map((l: any) => ({ name: l.site, url: l.url, type: l.type })),
    streaming: (m.externalLinks || []).filter((l: any) => l.type === 'STREAMING').map((l: any) => ({ name: l.site, url: l.url })),
    scoreDistribution: (m.stats?.scoreDistribution || []).slice().sort((a: any, b: any) => a.score - b.score),
    statusDistribution: (m.stats?.statusDistribution || []).map((d: any) => ({
      status: WATCH_STATUS[d.status] || d.status,
      amount: d.amount,
    })),
    anilistUrl: m.siteUrl || `https://anilist.co/anime/${m.id}`,
    malUrl: m.idMal ? `https://myanimelist.net/anime/${m.idMal}` : null,
  };
}

export function currentSeason(date = new Date()) {
  const month = date.getMonth();
  const seasons = ['WINTER', 'WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL'];
  return { season: seasons[month], year: date.getFullYear() };
}

export function nextSeason() {
  const { season, year } = currentSeason();
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const i = order.indexOf(season);
  return i === 3 ? { season: 'WINTER', year: year + 1 } : { season: order[i + 1], year };
}

// ── 1. Home Feed (Single-Query Batched GraphQL) ──────────────────────────────
export async function fetchHome(): Promise<Home> {
  const cur = currentSeason();
  const nxt = nextSeason();

  const q = `
    fragment fields on Media {
      ${MEDIA_FIELDS}
    }
    query ($season: MediaSeason, $seasonYear: Int, $nextSeason: MediaSeason, $nextSeasonYear: Int) {
      trending: Page(page: 1, perPage: 20) {
        media(type: ANIME, isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC], status: RELEASING) { ...fields }
      }
      seasonNow: Page(page: 1, perPage: 24) {
        media(type: ANIME, isAdult: false, sort: [POPULARITY_DESC], season: $season, seasonYear: $seasonYear) { ...fields }
      }
      topRated: Page(page: 1, perPage: 20) {
        media(type: ANIME, isAdult: false, sort: [SCORE_DESC], format_not: MUSIC) { ...fields }
      }
      popular: Page(page: 1, perPage: 20) {
        media(type: ANIME, isAdult: false, sort: [POPULARITY_DESC]) { ...fields }
      }
      upcoming: Page(page: 1, perPage: 20) {
        media(type: ANIME, isAdult: false, sort: [POPULARITY_DESC], season: $nextSeason, seasonYear: $nextSeasonYear) { ...fields }
      }
      movies: Page(page: 1, perPage: 20) {
        media(type: ANIME, isAdult: false, sort: [SCORE_DESC], format: MOVIE) { ...fields }
      }
    }
  `;

  const data = await query(q, {
    season: cur.season,
    seasonYear: cur.year,
    nextSeason: nxt.season,
    nextSeasonYear: nxt.year,
  });

  const trending: Anime[] = (data.trending?.media || []).map(normalize);
  const seasonNow: Anime[] = (data.seasonNow?.media || []).map(normalize);
  const topRated: Anime[] = (data.topRated?.media || []).map(normalize);
  const popular: Anime[] = (data.popular?.media || []).map(normalize);
  const upcoming: Anime[] = (data.upcoming?.media || []).map(normalize);
  const movies: Anime[] = (data.movies?.media || []).map(normalize);

  const candidates = [...trending, ...seasonNow].filter(
    (a, i, arr) => a.synopsis && arr.findIndex((b) => b.id === a.id) === i,
  );
  const spotlight = candidates.filter((a) => a.banner || a.image).slice(0, 8);

  return {
    spotlight,
    trending,
    seasonNow,
    topRated,
    popular,
    upcoming,
    movies,
  };
}

// ── 2. Detail Screen ────────────────────────────────────────────────────────
export async function fetchDetail(id: string): Promise<AnimeDetail> {
  const isAl = String(id).startsWith('al');
  const num = Number(String(id).replace(/^al/, ''));
  if (isNaN(num)) {
    throw new Error(`Invalid anime id: ${id}`);
  }

  const q = `query ($v: Int) { Media(${isAl ? 'id' : 'idMal'}: $v, type: ANIME) { ${DETAIL_FIELDS} } }`;
  try {
    const data = await query(q, { v: num });
    if (!data?.Media) throw new Error(`Anime not found for id: ${id}`);
    return normalizeDetail(data.Media);
  } catch (err: any) {
    if (!isAl) {
      // Fallback: If querying by idMal failed, try querying by AniList id
      try {
        const data2 = await query(`query ($v: Int) { Media(id: $v, type: ANIME) { ${DETAIL_FIELDS} } }`, { v: num });
        if (data2?.Media) return normalizeDetail(data2.Media);
      } catch {}
    }
    throw err;
  }
}

// ── 3. Extras (Cast and Recommendations) ────────────────────────────────────
export async function fetchExtras(id: string): Promise<{ characters: Character[]; recommendations: Anime[] }> {
  const isAl = String(id).startsWith('al');
  const num = Number(String(id).replace(/^al/, ''));
  const key = isAl ? 'id' : 'idMal';

  const q = `query ($v: Int) { Media(${key}: $v, type: ANIME) {
    characters(sort: [ROLE, RELEVANCE], perPage: 12) {
      edges { role node { name { full } image { medium } } voiceActors(language: JAPANESE) { name { full } } }
    }
    recommendations(sort: RATING_DESC, perPage: 12) {
      nodes { mediaRecommendation { ${MEDIA_FIELDS} } }
    }
  } }`;

  let data: any;
  try {
    data = await query(q, { v: num });
  } catch (err) {
    if (!isAl) {
      data = await query(
        `query ($v: Int) { Media(id: $v, type: ANIME) {
          characters(sort: [ROLE, RELEVANCE], perPage: 12) {
            edges { role node { name { full } image { medium } } voiceActors(language: JAPANESE) { name { full } } }
          }
          recommendations(sort: RATING_DESC, perPage: 12) {
            nodes { mediaRecommendation { ${MEDIA_FIELDS} } }
          }
        } }`,
        { v: num },
      );
    } else {
      throw err;
    }
  }

  const characters: Character[] = (data?.Media?.characters?.edges || []).map((e: any) => ({
    name: e.node?.name?.full || 'Unknown',
    image: e.node?.image?.medium || null,
    role: e.role === 'MAIN' ? 'Main' : 'Supporting',
    voiceActor: e.voiceActors?.[0]?.name?.full || null,
  }));

  const recommendations: Anime[] = (data?.Media?.recommendations?.nodes || [])
    .map((n: any) => n.mediaRecommendation)
    .filter((m: any) => m && !m.isAdult)
    .map(normalize);

  return { characters, recommendations };
}

// ── 4. Search and Filters ───────────────────────────────────────────────────
export async function fetchSearch(p: SearchParams): Promise<SearchResult> {
  const formats: Record<string, string> = { TV: 'TV', MOVIE: 'MOVIE', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'SPECIAL' };
  const statuses: Record<string, string> = { airing: 'RELEASING', finished: 'FINISHED', upcoming: 'NOT_YET_RELEASED' };
  const orders: Record<string, string> = {
    score: 'SCORE_DESC',
    popularity: 'POPULARITY_DESC',
    newest: 'START_DATE_DESC',
    title: 'TITLE_ENGLISH',
  };

  const sortValue = orders[p.order || ''] || (p.q ? 'SEARCH_MATCH' : 'POPULARITY_DESC');
  const args: Record<string, { type: string; value: any }> = {
    sort: { type: '[MediaSort]', value: [sortValue] },
  };

  if (p.q?.trim()) args.search = { type: 'String', value: p.q.trim() };
  if (p.genre?.trim()) args.genre = { type: 'String', value: p.genre.trim() };
  if (p.type && formats[p.type.toUpperCase()]) {
    args.format = { type: 'MediaFormat', value: formats[p.type.toUpperCase()] };
  }
  if (p.status && statuses[p.status]) {
    args.status = { type: 'MediaStatus', value: statuses[p.status] };
  }

  const perPage = 24;
  const pageNo = p.page || 1;

  const keys = Object.keys(args);
  const varDefs = keys.map((k) => `$${k}: ${args[k].type}`).join(', ');
  const filters = keys.map((k) => `${k}: $${k}`).join(', ');
  const values = Object.fromEntries(keys.map((k) => [k, args[k].value]));

  const q = `query ($page: Int, $perPage: Int${varDefs ? `, ${varDefs}` : ''}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage }
      media(type: ANIME, isAdult: false${filters ? `, ${filters}` : ''}) { ${MEDIA_FIELDS} }
    }
  }`;

  const data = await query(q, { page: pageNo, perPage, ...values });
  return {
    items: (data?.Page?.media || []).map(normalize),
    hasNext: Boolean(data?.Page?.pageInfo?.hasNextPage),
  };
}

// ── 5. Genres List ──────────────────────────────────────────────────────────
export async function fetchGenres(): Promise<string[]> {
  const data = await query('{ GenreCollection }');
  return (data?.GenreCollection || []).filter((g: string) => g !== 'Hentai');
}

// ── 6. Airing Schedule ──────────────────────────────────────────────────────
export async function fetchSchedule(day: string): Promise<Anime[]> {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const now = new Date();
  const target = new Date(now);
  const targetDayIdx = days.indexOf(day.toLowerCase());
  const currentDayIdx = now.getDay();
  const diff = (targetDayIdx - currentDayIdx + 7) % 7;
  target.setDate(now.getDate() + diff);
  target.setHours(0, 0, 0, 0);

  const from = Math.floor(target.getTime() / 1000);
  const q = `query ($from: Int, $to: Int) { Page(perPage: 50) {
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      episode airingAt media { ${MEDIA_FIELDS} }
    } } }`;

  const data = await query(q, { from, to: from + 86400 });
  return (data?.Page?.airingSchedules || [])
    .filter((s: any) => !s.media?.isAdult)
    .map((s: any) => ({
      ...normalize(s.media),
      nextEpisode: { episode: s.episode, airingAt: s.airingAt },
    }));
}

// ── 7. Seasons Builder ───────────────────────────────────────────────────────
export type SeasonItem = {
  season_number: number;
  name: string;
  title: string;
  episode_count: number;
  id?: number | string;
  anilistId?: number;
};

export function buildAnilistSeasons(m: any): SeasonItem[] {
  if (!m) return [];

  const mainTitle =
    (typeof m.title === 'string' && m.title.trim() ? m.title.trim() : null) ||
    m.title?.english ||
    m.title?.romaji ||
    (typeof m.titleRomaji === 'string' && m.titleRomaji.trim() ? m.titleRomaji.trim() : null) ||
    'Season 1';

  const mainAnilistId =
    (typeof m.anilistId === 'number' && m.anilistId > 0 ? m.anilistId : null) ||
    (m.id && String(m.id).startsWith('al') ? Number(String(m.id).replace(/^al/, '')) : null) ||
    (m.siteUrl && m.siteUrl.match(/anilist\.co\/anime\/(\d+)/) ? Number(m.siteUrl.match(/anilist\.co\/anime\/(\d+)/)[1]) : null) ||
    (m.anilistUrl && m.anilistUrl.match(/anilist\.co\/anime\/(\d+)/) ? Number(m.anilistUrl.match(/anilist\.co\/anime\/(\d+)/)[1]) : null) ||
    (typeof m.id === 'number' && m.id > 0 && m.idMal !== undefined ? m.id : null);

  const main: SeasonItem = {
    season_number: 1,
    name: 'Season 1',
    title: mainTitle,
    episode_count: m.episodes || 12,
    id: mainAnilistId || m.id,
    anilistId: mainAnilistId || undefined,
  };

  const sequels = (m.relations?.edges || [])
    .filter(
      (e: any) =>
        e.relationType === 'SEQUEL' &&
        e.node?.type === 'ANIME' &&
        (e.node?.format === 'TV' || e.node?.format === 'TV_SHORT'),
    )
    .map((e: any) => {
      const seqTitle =
        e.node.title?.english ||
        e.node.title?.romaji ||
        (typeof e.node.title === 'string' && e.node.title.trim() ? e.node.title.trim() : null) ||
        'Sequel';
      return {
        id: e.node.id,
        anilistId: e.node.id,
        title: seqTitle,
        episode_count: e.node.episodes || 12,
        year: e.node.startDate?.year || e.node.seasonYear || 9999,
        month: e.node.startDate?.month || 0,
      };
    })
    .sort((a: any, b: any) => (a.year !== b.year ? a.year - b.year : a.month - b.month));

  if (!sequels.length) {
    return [main];
  }

  return [
    main,
    ...sequels.map((s: any, idx: number) => ({
      season_number: idx + 2,
      name: `Season ${idx + 2}`,
      title: s.title,
      episode_count: s.episode_count,
      id: s.id,
      anilistId: s.anilistId || s.id,
    })),
  ];
}

// ── 8. Episodes List (HiAnime + AniList Resilience) ─────────────────────────
export async function fetchEpisodes(id: string, season = 1, animeDetail?: AnimeDetail): Promise<EpisodesData> {
  const anime = animeDetail || (await fetchDetail(id));
  const detectedSeasons = buildAnilistSeasons(anime);
  const currentSeasonInfo = detectedSeasons.find((s) => s.season_number === season) || detectedSeasons[0] || {
    season_number: season,
    name: `Season ${season}`,
    title: anime.title,
    episode_count: anime.episodes || 12,
  };

  // 1. Scrape live released episodes directly from HiAnime
  let hiAnimeCount = 0;
  try {
    const candidateTitles = [
      currentSeasonInfo.title,
      season > 1 ? (await anilistSeasonTitle(anime.title, season)).title : null,
      anime.title,
      anime.titleRomaji,
    ].filter(Boolean) as string[];

    for (const candidate of candidateTitles) {
      const results = await hianimeSearch(candidate);
      if (results.length > 0) {
        const epList = await hianimeEpisodes(results[0].id);
        if (epList.length > 0) {
          hiAnimeCount = epList.length;
          break;
        }
      }
    }
  } catch (err: any) {
    console.warn('[episodes] HiAnime episodes lookup fallback:', err?.message);
  }

  // 2. AniList episode count fallback
  let totalEp = currentSeasonInfo.episode_count || anime.episodes || 12;
  if (anime.airing || anime.status === 'Currently Airing' || anime.status === 'Releasing') {
    const nextEp = anime.nextEpisode?.episode ? Number(anime.nextEpisode.episode) : 0;
    if (nextEp > 1) {
      totalEp = Math.min(totalEp, nextEp - 1);
    }
  } else if (anime.status === 'Not yet aired' || anime.status === 'NOT_YET_RELEASED') {
    totalEp = 0;
  }

  const count = Math.max(hiAnimeCount, totalEp, 1);
  const episodeList: Episode[] = [];
  for (let i = 1; i <= count; i++) {
    episodeList.push({
      episode_number: i,
      season_number: season,
      name: `Episode ${i}`,
      overview: anime.synopsis ? `${anime.synopsis.slice(0, 160)}…` : '',
      still_path: anime.banner || anime.image || null,
      air_date: anime.aired || null,
      runtime: anime.duration ? parseInt(anime.duration, 10) : 24,
      hasSub: true,
      hasDub: true,
    });
  }

  return {
    tmdbId: null,
    showName: currentSeasonInfo.title || anime.title,
    backdrop: anime.banner || anime.image || null,
    seasons: detectedSeasons.map((s) => ({
      season_number: s.season_number,
      name: s.name,
      episode_count: s.episode_count,
      id: s.id,
      title: s.title,
      anilistId: typeof s.id === 'number' ? s.id : (s.id && !isNaN(Number(s.id)) ? Number(s.id) : undefined),
    })),
    selectedSeason: season,
    episodes: episodeList,
    dubCount: count,
    subCount: count,
  };
}
