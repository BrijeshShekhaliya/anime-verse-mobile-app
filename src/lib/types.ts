// Shapes returned by the AnimeVerse API (same server as the website).
export type Languages = {
  audio: string[];
  subtitles: string[];
  sub: boolean;
  dub: 'full' | 'partial' | null;
};

export type NextEpisode = { episode: number; airingAt: number } | null;

export type Anime = {
  id: string;
  malId?: number | null;
  anilistId?: number | null;
  title: string;
  titleRomaji?: string | null;
  titleJapanese?: string | null;
  image?: string | null;
  image2x?: string | null;
  banner?: string | null;
  backdrop?: string | null;
  logo?: string | null;
  logoAspect?: number | null;
  synopsis?: string | null;
  score?: number | null;
  scoredBy?: number | null;
  rank?: number | null;
  members?: number | null;
  episodes?: number | null;
  status?: string | null;
  airing?: boolean;
  type?: string | null;
  season?: string | null;
  year?: number | null;
  genres?: string[];
  studios?: string[];
  duration?: string | null;
  aired?: string | null;
  trailer?: string | null;
  nextEpisode?: NextEpisode;
  languages?: Languages;
  seasonCount?: number | null;
  episodeCount?: number | null;
  tmdbStatus?: string | null;
  tmdbPoster?: string | null;
  contentRating?: string | null;
  factsPending?: boolean;
  source?: string;
};

export type Relation = {
  relation: string;
  id: string | null;
  kind: string;
  title: string;
  image: string | null;
  format: string | null;
  year: number | null;
};

export type AnimeDetail = Anime & {
  relations?: Relation[];
  links?: { name: string; url: string; type: string }[];
  streaming?: { name: string; url: string }[];
  scoreDistribution?: { score: number; amount: number }[];
  statusDistribution?: { status: string; amount: number }[];
  malUrl?: string | null;
  anilistUrl?: string | null;
};

export type Character = { name: string; image?: string | null; role: string; voiceActor?: string | null };

export type Home = {
  spotlight: Anime[];
  trending: Anime[];
  seasonNow: Anime[];
  topRated: Anime[];
  popular: Anime[];
  upcoming: Anime[];
  movies: Anime[];
};

export type SearchResult = { items: Anime[]; hasNext: boolean };

export type Episode = {
  episode_number: number;
  season_number: number;
  name: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  hasSub?: boolean;
  hasDub?: boolean;
};

export type SeasonInfo = {
  season_number: number;
  name: string;
  episode_count: number;
  id?: number | string;
  title?: string;
  anilistId?: number;
};

export type EpisodesData = {
  tmdbId?: number | null;
  showName: string;
  backdrop?: string | null;
  seasons: SeasonInfo[];
  selectedSeason: number;
  episodes: Episode[];
  dubCount?: number;
  subCount?: number;
};

export type SubtitleTrack = {
  lang?: string;
  label: string;
  kind: string;
  src: string;
  default?: boolean;
};

export type StreamAudioTrack = {
  id: string;
  name: string;
  language: string;
  groupId: string | null;
  uri: string | null;
  isDefault: boolean;
  isAutoselect: boolean;
  channels: string | null;
};

export type StreamData = {
  success: boolean;
  source: string;
  mode: 'sub' | 'dub';
  seasonNumber: number;
  episodeNumber: number;
  streamUrl: string;
  rawMasterUrl?: string;
  referer?: string;
  subtitles?: SubtitleTrack[];
  // Dynamic in-manifest audio renditions discovered by the resolver.
  audioTracks?: StreamAudioTrack[];
  // Dynamic in-manifest video quality levels (e.g. 1080p, 720p, 480p, 360p).
  videoLevels?: Array<{ index: number; width: number; height: number; bitrate: number }>;
};

