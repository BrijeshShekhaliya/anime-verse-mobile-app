// Where an episode should start, from what was saved about it.
type Saved = { episode: number; season?: number; time?: number; completed?: boolean };

// Less than this and there's nothing worth coming back to.
const MIN_RESUME_SECONDS = 10;

export function resumePosition(saved: Saved | null | undefined, season: number, episode: number): number {
  // Saves from before seasons were recorded count as season 1.
  if (!saved || saved.episode !== episode || (saved.season ?? 1) !== season) return 0;
  // Finished (past 85%): watching it again starts from the beginning.
  if (saved.completed) return 0;
  const time = saved.time ?? 0;
  return time >= MIN_RESUME_SECONDS ? time : 0;
}

// Watched past this much of a real length counts as finished. A very short "length" is a
// player that hasn't finished reading the video yet, not a very short episode.
const FINISHED_AT = 0.85;
const SHORTEST_REAL_LENGTH = 60;
export function isFinished(time: number, duration: number): boolean {
  return duration >= SHORTEST_REAL_LENGTH && time / duration >= FINISHED_AT;
}

// An "ended" signal only counts near the real end of the video.
const END_MARGIN_SECONDS = 20;
export function isRealEnd(time: number, duration: number): boolean {
  return duration > 0 && time >= duration - END_MARGIN_SECONDS;
}

// What a Continue card shows and opens. The bar is the place within the episode that
// opens, so one minute of a 24-minute episode looks like one minute.
export function continueState(item: { episode: number; total?: number | null; time?: number; duration?: number; completed?: boolean }) {
  const finished = Boolean(item.completed);
  const done = finished && !!item.total && item.episode >= item.total;
  const time = item.time ?? 0;
  const duration = item.duration ?? 0;
  const fraction = done ? 1 : finished || duration <= 0 ? 0 : Math.min(1, Math.max(0, time / duration));
  return {
    done,
    targetEp: finished && !done ? item.episode + 1 : item.episode,
    fraction,
    position: !finished && duration > 0 && time > 0 ? { time, duration } : null,
    left: item.total ? Math.max(0, item.total - (finished ? item.episode : item.episode - 1)) : null,
  };
}

// Which entry of the show a season is. "Season 2" counts from the entry the show was opened on.
export function seasonIndex(seasons: { anilistId: number }[], anilistId: number, season: number): number {
  const opened = seasons.findIndex((s) => s.anilistId === anilistId);
  if (opened < 0) return -1;
  const target = opened + Math.max(0, season - 1);
  return target < seasons.length ? target : -1;
}

// An episode's number counting from the show's first episode, which is how pictures are
// matched. Null when an earlier season's length isn't known: better no picture than the
// wrong episode's.
export function absoluteEpisode(
  seasons: { anilistId: number; episodes: number | null }[],
  anilistId: number,
  season: number,
  episode: number,
): number | null {
  const target = seasonIndex(seasons, anilistId, season);
  if (target < 0) return null;
  let sum = episode;
  for (let i = 0; i < target; i++) {
    const n = seasons[i].episodes;
    if (!n) return null;
    sum += n;
  }
  return sum;
}

// The episode's name: the guide's, or TMDB's when the guide only has "Episode 3".
export function episodeName(episode: number, guideTitle: string | null | undefined, tmdbName: string | null | undefined): string {
  const plain = `Episode ${episode}`;
  if (guideTitle && guideTitle !== plain) return guideTitle;
  return tmdbName || plain;
}
