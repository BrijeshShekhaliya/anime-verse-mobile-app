// Release schedule by calendar date (AniList airing times). A day is your local
// midnight to midnight, so every episode lands on the day it airs for you.
// One request per day; a second page only on very busy days (50+ episodes).
import { normalize, query } from '@/services/anilistClient';
import type { Anime } from './types';

const FIELDS = `id idMal title { romaji english native } coverImage { extraLarge large color } bannerImage
  description(asHtml: false) averageScore meanScore popularity episodes status format season seasonYear
  duration genres isAdult startDate { year month day } nextAiringEpisode { episode airingAt }`;

const pad = (n: number) => String(n).padStart(2, '0');

// "2026-10-30" for a local date.
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export async function fetchScheduleForDate(key: string): Promise<Anime[]> {
  const [y, m, d] = key.split('-').map(Number);
  // Local midnight to the next local midnight (correct across daylight-saving changes).
  const from = Math.floor(new Date(y, m - 1, d).getTime() / 1000) - 1; // airingAt_greater is exclusive
  const to = Math.floor(new Date(y, m - 1, d + 1).getTime() / 1000);
  const out: Anime[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await query(
      `query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          episode airingAt media { ${FIELDS} }
        } } }`,
      { from, to, page }
    );
    for (const s of data?.Page?.airingSchedules || []) {
      if (s.media?.isAdult) continue;
      out.push({ ...normalize(s.media), nextEpisode: { episode: s.episode, airingAt: s.airingAt } });
    }
    if (!data?.Page?.pageInfo?.hasNextPage) break;
  }
  return out;
}
