// Episode guide for the anime page, from AniList only: every season of a show
// (following the prequel/sequel chain) and each season's episode titles,
// thumbnails and air dates.
import { query } from '@/services/anilistClient';

export type GuideSeason = {
  anilistId: number;
  id: string; // app id (MAL id, or "al<id>"), as used in routes
  seasonNumber: number; // 1, 2, 3...
  label: string; // "Season 1", "Season 2", "Final Season Part 2"
  title: string; // "Attack on Titan Season 2"
  episodes: number | null;
  year: number | null;
};

export type GuideEpisode = {
  number: number;
  title: string;
  thumb: string | null;
  airingAt: number | null;
};

type Node = {
  id: number;
  idMal: number | null;
  type: string;
  format: string | null;
  status: string | null;
  title: { english: string | null; romaji: string | null };
  startDate: { year: number | null; month: number | null } | null;
  episodes: number | null;
  relations?: { edges: { relationType: string; node: Node }[] };
};

const NODE = 'id idMal type format status title { english romaji } startDate { year month } episodes';
const nested = (depth: number): string =>
  depth === 0 ? '' : `relations { edges { relationType node { ${NODE} ${nested(depth - 1)} } } }`;

const SEASON_FORMATS = new Set(['TV']);

function isSeason(n: Node, rootId?: number): boolean {
  if (n.type !== 'ANIME') return false;
  if (!n.format || !SEASON_FORMATS.has(n.format)) return false;
  // Filter unreleased sequels or cancelled relations that have no released episodes
  if (rootId && n.id !== rootId) {
    if (n.status === 'NOT_YET_RELEASED' || n.status === 'CANCELLED') {
      if (n.episodes === null || n.episodes === 0) return false;
    }
  }
  return true;
}

export function cleanSeasonLabel(english: string | null, romaji: string | null, index: number): string {
  const full = (english || romaji || '').trim();
  if (index === 0) return 'Season 1';

  // Check for Final Season Part X or Final Season
  const finalPartMatch = full.match(/Final Season(?:\s*(?:Part|Cour)\s*(\d+|II|III|IV))?/i);
  if (finalPartMatch) {
    if (finalPartMatch[1]) {
      return `Final Season Part ${finalPartMatch[1]}`;
    }
    return `Final Season`;
  }

  // Check for Season X Part Y or Season X Cour Y
  const sPartMatch = full.match(/Season\s*(\d+)(?:\s*(?:Part|Cour)\s*(\d+|II|III|IV))?/i);
  if (sPartMatch) {
    if (sPartMatch[2]) {
      return `Season ${sPartMatch[1]} Part ${sPartMatch[2]}`;
    }
    return `Season ${sPartMatch[1]}`;
  }

  // Check for 2nd Season, 3rd Season, etc.
  const ordMatch = full.match(/(\d+)(?:nd|rd|th)\s+Season/i);
  if (ordMatch) {
    return `Season ${ordMatch[1]}`;
  }

  // Check for Cour 2 (e.g. Mushoku Tensei Cour 2)
  const courMatch = full.match(/Cour\s*(\d+|II|III|IV)/i);
  if (courMatch) {
    return `Cour ${courMatch[1]}`;
  }

  // Check for specific Arc names: "Demon Slayer: Kimetsu no Yaiba Mugen Train Arc" -> "Mugen Train Arc"
  const arcMatch = full.match(/(?:(?:Kimetsu no Yaiba|Shingeki no Kyojin)\s+)?([A-Za-z0-9\s]+?)\s+Arc\b/i);
  if (arcMatch && arcMatch[1]) {
    const words = arcMatch[1].trim().split(/\s+/).filter((w) => !['no', 'yaiba', 'kimetsu'].includes(w.toLowerCase()));
    const arcTitle = words.slice(-3).join(' ');
    if (arcTitle) return `${arcTitle} Arc`;
  }

  return `Season ${index + 1}`;
}

export const anilistIdOf = (a: { anilistUrl?: string | null; id: string }) => {
  const m = a.anilistUrl?.match(/anilist\.co\/anime\/(\d+)/);
  if (m) return Number(m[1]);
  return a.id.startsWith('al') ? Number(a.id.slice(2)) : null;
};

// Every season of the show, oldest first. One AniList request reaches three
// seasons each way; it keeps going from the ends until nothing new turns up.
export async function fetchSeasons(anilistId: number): Promise<GuideSeason[]> {
  const found = new Map<number, Node>();
  const explored = new Set<number>();

  // Follows prequel/sequel links from an entry (whether or not it was seen before).
  const follow = (n: Node) => {
    for (const e of n.relations?.edges || []) {
      if (
        (e.relationType === 'SEQUEL' || e.relationType === 'PREQUEL') &&
        isSeason(e.node, anilistId) &&
        !found.has(e.node.id)
      ) {
        found.set(e.node.id, e.node);
        follow(e.node);
      }
    }
  };

  const fetchFrom = async (id: number) => {
    explored.add(id);
    const data = await query(`query ($id: Int) { Media(id: $id, type: ANIME) { ${NODE} ${nested(3)} } }`, { id });
    const root: Node | undefined = data?.Media;
    if (!root) return;
    // The page's own entry always counts
    found.set(root.id, root);
    follow(root);
  };

  await fetchFrom(anilistId);
  for (let round = 0; round < 4; round++) {
    const list = sorted(found);
    const ends = [list[0], list[list.length - 1]].filter((n) => n && !explored.has(n.id));
    if (!ends.length) break;
    const before = found.size;
    await Promise.all(ends.map((n) => fetchFrom(n.id)));
    if (found.size === before) break;
  }

  return sorted(found).map((n, i) => ({
    anilistId: n.id,
    id: n.idMal ? String(n.idMal) : `al${n.id}`,
    seasonNumber: i + 1,
    label: cleanSeasonLabel(n.title.english, n.title.romaji, i),
    title: n.title.english || n.title.romaji || `Season ${i + 1}`,
    episodes: n.episodes,
    year: n.startDate?.year ?? null,
  }));
}

const sorted = (m: Map<number, Node>) =>
  [...m.values()].sort(
    (a, b) =>
      (a.startDate?.year || 9999) - (b.startDate?.year || 9999) ||
      (a.startDate?.month || 0) - (b.startDate?.month || 0),
  );

// One season's episodes. Titles and thumbnails come from AniList's episode
// list ("Episode 3 - A Dim Light…"); air dates from its airing schedule.
export async function fetchEpisodeGuide(anilistId: number): Promise<GuideEpisode[]> {
  const data = await query(
    `query ($id: Int) { Media(id: $id, type: ANIME) {
      id episodes status nextAiringEpisode { episode }
      title { english romaji }
      streamingEpisodes { title thumbnail }
      airingSchedule(perPage: 50) { nodes { episode airingAt } }
    } }`,
    { id: anilistId },
  );
  const m = data?.Media;
  if (!m) return [];

  const parsed: { num: number; title: string; thumb: string | null }[] = [];
  for (const e of m.streamingEpisodes || []) {
    const match = /^Episode\s+(\d+)\s*[-–:]\s*(.+)$/i.exec(e.title || '');
    if (match) {
      parsed.push({
        num: Number(match[1]),
        title: match[2].trim(),
        thumb: e.thumbnail || null,
      });
    }
  }

  const airing = new Map<number, number>();
  for (const s of m.airingSchedule?.nodes || []) airing.set(s.episode, s.airingAt);

  // Released so far: up to the next airing episode for a show still airing.
  const total =
    m.status === 'RELEASING' && m.nextAiringEpisode?.episode
      ? m.nextAiringEpisode.episode - 1
      : m.episodes || (parsed.length ? Math.max(...parsed.map((p) => p.num)) : 12);

  // Analyze parsed streamingEpisodes to avoid AniList cross-season duplicate corruption:
  const epNums = parsed.map((p) => p.num).sort((a, b) => a - b);
  const minEp = epNums.length ? epNums[0] : 1;
  const maxEp = epNums.length ? epNums[epNums.length - 1] : 1;

  // Validation rules:
  // 1. If minEp > total, these episodes are from a sequel attached mistakenly to season 1 (e.g. SL S1 has eps 13..25). Reject.
  // 2. If parsed has way more episodes than this season (e.g. AoT S2 has 12 eps but parsed has 25 eps from S1). Reject.
  const isInvalidForThisSeason =
    Boolean(m.episodes && minEp > m.episodes) ||
    Boolean(m.episodes && parsed.length > m.episodes && parsed.length >= 20);

  const episodeMap = new Map<number, { title: string; thumb: string | null }>();
  if (!isInvalidForThisSeason) {
    if (minEp > 1 && maxEp >= total) {
      // Continuous numbering for sequel (e.g. Solo Leveling S2: episodes 13..25 for total = 13)
      const offset = minEp - 1;
      for (const p of parsed) {
        const localNum = p.num - offset;
        if (localNum >= 1 && localNum <= total) {
          episodeMap.set(localNum, { title: p.title, thumb: p.thumb });
        }
      }
    } else {
      // Standard 1..N
      for (const p of parsed) {
        if (p.num <= total) {
          episodeMap.set(p.num, { title: p.title, thumb: p.thumb });
        }
      }
    }
  }

  return Array.from({ length: Math.max(0, total) }, (_, i) => {
    const n = i + 1;
    const hit = episodeMap.get(n);
    return {
      number: n,
      title: hit?.title || `Episode ${n}`,
      thumb: hit?.thumb || null,
      airingAt: airing.get(n) ?? null,
    };
  });
}
