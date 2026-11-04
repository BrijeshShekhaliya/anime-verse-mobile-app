import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlayerOverlay, type QuickChip } from '@/components/player/PlayerOverlay';
import { PlayerSettingsSheet, type SheetSection } from '@/components/player/PlayerSettingsSheet';
import NativeHlsPlayer, { type NativePlayerTrack, type NativeVideoLevel } from '@/components/player/NativeHlsPlayer';
import { isAudioLanguageMatch } from '@/components/player/ExpoVideoHlsPlayer';
import { isStreamUrlExpired } from '@/services/animerulzClient';
import { airDateLabel } from '@/lib/airDate';
import { EpisodeBadges } from '@/components/Badges';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { api, toFullUrl } from '@/lib/api';
import { useLibrary } from '@/lib/library';
import { useSettings, displayTitle } from '@/lib/settings';
import { colors, fonts, radius } from '@/lib/theme';
import { useDetail, useSeasons, useTmdbShow, useTmdbStills } from '@/lib/queries';
import { backdropOf, stillFor, tmdbImagesBlocked, tmdbPosition, useArt } from '@/lib/artwork';
import type { Episode, EpisodesData, StreamData } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';


const AUTOPLAY_STORAGE_KEY = 'animeverse:autoplay';
type FitMode = 'contain' | 'cover' | 'fill';

interface AudioTrackInfo {
  id: number;
  name: string;
  lang: string;
}

interface TextTrackInfo {
  id: number;
  name: string;
  lang: string;
}

interface VideoLevelInfo {
  index: number;
  height: number;
  width: number;
  bitrate: number;
}

// The main server carries every language; anything else is the single-language backup.
const isMainStream = (s?: StreamData | null) => !!s?.source?.toLowerCase().includes('multi');

// Formats seconds into M:SS or H:MM:SS
function formatDuration(sec: number) {
  if (!sec || isNaN(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sStr = s < 10 ? `0${s}` : `${s}`;
  if (h > 0) {
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mStr}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

export default function WatchScreen() {
  const { id, season: paramSeason, ep: paramEp } = useLocalSearchParams<{ id: string; season?: string; ep?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();


  // The layout follows the screen's real shape, measured from this screen's own
  // root view, and nothing else. The window size from useWindowDimensions is not
  // trustworthy here: on this app it isn't updated when the screen turns (the
  // activity handles rotation itself), so it kept saying "portrait" in landscape
  // and "landscape" back in portrait. That stale size is what showed the
  // portrait player on a landscape screen, and the fullscreen player with black
  // bars on a portrait one. The root view's measured size is what is actually
  // on screen, so the layout switches the moment the turn lands, both ways.
  const [screen, setScreen] = useState({ w: width, h: height });
  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) setScreen((p) => (p.w === Math.round(w) && p.h === Math.round(h) ? p : { w: Math.round(w), h: Math.round(h) }));
  }, []);
  // Only that measured size decides fullscreen. Layout events arrive in order
  // and always describe the frame on screen, so nothing can overwrite them with
  // an older answer. (Asking the phone for its orientation is asynchronous: the
  // answer to a question asked just before a turn could arrive after the turn's
  // own event and undo it, which made fullscreen work only some of the time.)
  const isFullscreenView = screen.w > screen.h;
  const topInset = Platform.OS === 'android' ? Math.max(insets.top, RNStatusBar.currentHeight || 0) : insets.top;

  const { titleLang, audioLang, quality: userQuality } = useSettings();

  const defaultQualityHeight = useMemo(() => {
    switch (userQuality) {
      case 'highest':
        return 1080;
      case 'saver':
        return 480;
      case 'medium':
      default:
        return 720;
    }
  }, [userQuality]);

  // Session continuity: remember mid-video manual overrides across episodes of this watch session
  const sessionAudioOverrideRef = useRef<string | null>(null);
  const sessionQualityOverrideRef = useRef<number | null>(null);
  const preferredAudioLang = (sessionAudioOverrideRef.current || audioLang || 'hindi').toLowerCase();

  const [currentSeason, setCurrentSeason] = useState<number>(Math.max(1, parseInt(paramSeason || '1', 10) || 1));
  const [currentEp, setCurrentEp] = useState<number>(Math.max(1, parseInt(paramEp || '1', 10) || 1));
  const [retryNonce, setRetryNonce] = useState(0); // bumped by "Try again"
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(false); // off until asked for
  const [fitMode, setFitMode] = useState<FitMode>('contain'); // Default: contain (100% video visible, no crop)
  const [badgeText, setBadgeText] = useState<string | null>(null);

  // Dynamic Audio Tracks & Quality from Hls.js stream
  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState<number>(0);
  const [hasInBandAlternateAudio, setHasInBandAlternateAudio] = useState<boolean>(false);
  const [currentLang, setCurrentLang] = useState<'sub' | 'dub'>('sub');
  const [playerPreferencesLoaded, setPlayerPreferencesLoaded] = useState<boolean>(true);
  const [isSwitchingAudio, setIsSwitchingAudio] = useState<boolean>(false);

  const [availableLevels, setAvailableLevels] = useState<VideoLevelInfo[]>([]);
  const [availableTextTracks, setAvailableTextTracks] = useState<TextTrackInfo[]>([]);
  const [selectedQualityHeight, setSelectedQualityHeight] = useState<number>(defaultQualityHeight); // Default from user settings

  const [hlsStream, setHlsStream] = useState<StreamData | null>(null);
  const [mountedStream, setMountedStream] = useState<StreamData | null>(null);
  const [resolvingHls, setResolvingHls] = useState<boolean>(false);
  const [hlsError, setHlsError] = useState<string | null>(null);

  // Playback states
  // The time goes straight to the seek bar on the UI thread. As React state it
  // redrew this whole screen several times a second, which is what made every
  // touch and button wait its turn.
  const playbackTime = useSharedValue(0);
  const playbackBuffered = useSharedValue(0);
  const [duration, setDuration] = useState<number>(1429); // fallback ~23:49
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [showAdvisory, setShowAdvisory] = useState<boolean>(true);

  // Settings
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [volume, setVolume] = useState<number>(1); // the player's own volume (drag up / down on the right)

  // Likes / Interactions
  const [liked, setLiked] = useState<boolean>(false);
  const [disliked, setDisliked] = useState<boolean>(false);
  const [likeCount, setLikeCount] = useState<number>(2940);
  const [dislikeCount, setDislikeCount] = useState<number>(18);

  const nativeVideoRef = useRef<any>(null);
  const nativePlayerTimeRef = useRef(0);
  const nativeSeekTargetRef = useRef<number | null>(null);
  const seekStartedAtRef = useRef(0);
  const nativeSourceKeyRef = useRef<string | null>(null);
  const [nativeAudioTrackId, setNativeAudioTrackId] = useState<number | null>(null);
  const [nativeTextTrackId, setNativeTextTrackId] = useState<number | null>(null);
  const [resumeAfterSourceChange, setResumeAfterSourceChange] = useState<{ key: string; time: number; shouldPlay: boolean } | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advisoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPinchDistRef = useRef<number | null>(null);
  const { setProgress } = useLibrary();
  const recordedEpRef = useRef<string | null>(null);
  const progressBarWidthRef = useRef<number>(width);

  const mountedStreamEpisodeKeyRef = useRef<string | null>(null);
  const audioSwitchRequestRef = useRef(0);

  // Live state refs to capture values synchronously during stream switches
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(1429);
  const lastProgressCompletedRef = useRef<boolean>(false);
  const lastProgressSavedTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(true);
  const playbackSpeedRef = useRef<number>(1.0);
  const subtitlesEnabledRef = useRef<boolean>(false);
  const selectedQualityRef = useRef<number>(-1);
  const currentLangRef = useRef<'sub' | 'dub'>('sub');
  const preferredAudioNameRef = useRef<string | null>(null);
  const lastLoggedResolutionRef = useRef<string>('');
  const [playingHeight, setPlayingHeight] = useState(0); // the resolution actually on screen
  const streamCacheRef = useRef<Map<string, { data: StreamData; expiresAt: number }>>(new Map());
  const inflightResolutionsRef = useRef<Map<string, Promise<StreamData>>>(new Map());
  const playerRetryCountRef = useRef<Record<string, number>>({});
  const prefetchedNextEpRef = useRef<string | null>(null);
  const episodeRequestSeqRef = useRef<number>(0);

  // Initialize playback preferences directly from user Settings with session continuity
  useEffect(() => {
    let active = true;

    // 1. Audio: Session override takes precedence over global setting
    const activeAudio = (sessionAudioOverrideRef.current || audioLang || 'hindi').toLowerCase();
    preferredAudioNameRef.current = activeAudio;
    const initialMode: 'sub' | 'dub' = activeAudio === 'japanese' ? 'sub' : 'dub';
    setCurrentLang(initialMode);
    currentLangRef.current = initialMode;

    // 2. Quality: Session override takes precedence over global setting
    const initialHeight = sessionQualityOverrideRef.current ?? defaultQualityHeight;
    setSelectedQualityHeight(initialHeight);
    selectedQualityRef.current = initialHeight;

    // 3. Autoplay from device storage
    AsyncStorage.getItem(AUTOPLAY_STORAGE_KEY).catch(() => null).then((savedAutoplay) => {
      if (!active) return;
      if (savedAutoplay !== null) setAutoplay(savedAutoplay === '1');
      setPlayerPreferencesLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [audioLang, defaultQualityHeight]);


  // Stale callback protection across episode/stream switches
  const currentEpisodeKeyRef = useRef<string>(`${currentSeason}:${currentEp}`);
  useEffect(() => {
    currentEpisodeKeyRef.current = `${currentSeason}:${currentEp}`;
  }, [currentSeason, currentEp]);

  // Integrated Orientation Control (immediate non-blocking request)
  const enterLandscape = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  // The app is portrait-only: leaving fullscreen locks portrait again (never
  // "unlock", which would let the whole app rotate and, with the phone held
  // sideways, bounce straight back into fullscreen).
  const restoreOrientation = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Status and navigation bars switch the moment the button is tapped (not
  // after the screen has re-rendered, which can take most of a second).
  const setSystemBarsHidden = useCallback((hidden: boolean) => {
    RNStatusBar.setHidden(hidden, 'none');
    if (Platform.OS === 'android') NavigationBar.setVisibilityAsync(hidden ? 'hidden' : 'visible').catch(() => {});
  }, []);

  const enterFullscreen = useCallback(() => {
    // Bars go now; the layout follows the turn natively.
    setSystemBarsHidden(true);
    setControlsVisible(false);
    enterLandscape();
  }, [enterLandscape, setSystemBarsHidden]);

  const exitFullscreen = useCallback(() => {
    // Same in reverse.
    setSystemBarsHidden(false);
    setControlsVisible(false);
    restoreOrientation();
  }, [restoreOrientation, setSystemBarsHidden]);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreenView) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreenView, enterFullscreen, exitFullscreen]);

  // Controls hide while the screen turns (they reappear on the next tap).
  useEffect(() => {
    const sub = ScreenOrientation.addOrientationChangeListener(() => {
      setControlsVisible(false);
    });
    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
    };
  }, []);

  // Handle hardware Android back button / back swipe
  useEffect(() => {
    const onBackPress = () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (isFullscreenView) {
        // Exit fullscreen to portrait instead of navigating away!
        exitFullscreen();
        return true;
      }
      return false; // In portrait, let default router back handle it
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isFullscreenView, settingsOpen, exitFullscreen]);

  // Keeps the bars matching the screen if it turned some other way (the
  // buttons already switched them at the tap; this repeats the same value).
  useEffect(() => {
    setSystemBarsHidden(isFullscreenView);
  }, [isFullscreenView, setSystemBarsHidden]);

  // Leaving the player: system bars back, and back to the app's portrait lock.
  useEffect(() => {
    return () => {
      RNStatusBar.setHidden(false, 'none');
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible').catch(() => {});
      }
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Show on-screen toast badge
  const showBadge = useCallback((text: string) => {
    setBadgeText(text);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(() => {
      setBadgeText(null);
    }, 1500);
  }, []);

  // Fit / zoom / stretch for the video, with a short confirmation.
  const changeFitMode = useCallback(
    (newMode: FitMode) => {
      setFitMode(newMode);
      if (newMode === 'contain') showBadge('Fit to screen');
      else if (newMode === 'cover') showBadge('Zoomed to fill');
      else showBadge('Stretch to screen');
    },
    [showBadge],
  );

  const cycleFitMode = useCallback(() => {
    if (fitMode === 'contain') changeFitMode('cover');
    else if (fitMode === 'cover') changeFitMode('fill');
    else changeFitMode('contain');
  }, [fitMode, changeFitMode]);

  // Fetch anime detail with instant synchronous cache
  const initialAnime = useMemo(() => api.getCachedDetail(String(id)), [id]);
  const detailQ = useDetail(String(id));
  const anime = detailQ.data ?? initialAnime ?? null;
  // Full details are in (the tapped card's basics don't count), or aren't coming.
  const fullDetail = detailQ.data && !detailQ.isPlaceholderData ? detailQ.data : undefined;
  const detailSettled = !!fullDetail || detailQ.isError;

  // Synchronous AniList ID resolution (0ms startup without waiting for network GraphQL)
  const initialAnilistId = useMemo(() => {
    // Only "al123" ids are AniList's. A plain number is a MyAnimeList id: treating
    // it as AniList's asked the stream source for a different show entirely.
    if (typeof id === 'string' && id.startsWith('al')) {
      const p = parseInt(id.slice(2), 10);
      if (!isNaN(p) && p > 0) return p;
    }
    return initialAnime?.anilistId || undefined;
  }, [id, initialAnime?.anilistId]);

  // Fetch episodes for current season with instant synchronous cache
  const initialEps = useMemo(() => api.getCachedEpisodes(String(id), currentSeason), [id, currentSeason]);
  const { data: epData, loading: episodesLoading } = useFetch<EpisodesData>(
    () => (detailSettled ? api.episodes(String(id), currentSeason, false, fullDetail) : new Promise<EpisodesData>(() => {})),
    [id, currentSeason, detailSettled],
    initialEps,
  );

  const episodes = useMemo(() => epData?.episodes || [], [epData]);
  const currentEpisodeObj = useMemo(
    () => episodes.find((e) => e.episode_number === currentEp) || null,
    [episodes, currentEp],
  );
  const nextEpisodeObj = useMemo(
    () => episodes.find((e) => e.episode_number === currentEp + 1) || null,
    [episodes, currentEp],
  );
  // Up Next's picture: that episode's TMDB still (episodes are matched by absolute
  // number, as on the anime page), else the show's TMDB banner. The same saved
  // requests as the anime page, so usually nothing extra is fetched.
  const { art: showArt, settled: showArtSettled } = useArt(anime, true);
  const seasonsQ = useSeasons(anime?.anilistId ?? null);
  const nextAbsolute = useMemo(() => {
    if (!nextEpisodeObj || !seasonsQ.data || !anime?.anilistId) return null;
    const idx = seasonsQ.data.findIndex((x) => x.anilistId === anime.anilistId);
    if (idx < 0) return null;
    let sum = nextEpisodeObj.episode_number;
    for (let i = 0; i < idx; i++) {
      const n = seasonsQ.data[i].episodes;
      if (!n) return null; // an earlier season's length is unknown: can't place it
      sum += n;
    }
    return sum;
  }, [nextEpisodeObj, seasonsQ.data, anime?.anilistId]);
  const tmdbShow = useTmdbShow(nextEpisodeObj ? anime : null);
  const nextStills = useTmdbStills(nextAbsolute == null ? null : tmdbShow.data, nextAbsolute ?? 0, nextAbsolute ?? 0, !!anime?.airing);
  const nextPosition = tmdbShow.data && nextAbsolute != null ? tmdbPosition(tmdbShow.data, nextAbsolute) : null;
  const nextStill = nextPosition && !tmdbImagesBlocked() ? stillFor(nextStills.map.get(`${nextPosition.season}:${nextPosition.episode}`)?.still) : null;
  // Waits for TMDB's answer about the still, so the banner never shows first and gets swapped.
  const nextStillPending = tmdbShow.isLoading || seasonsQ.isLoading || (nextAbsolute != null && nextStills.pending);
  const upNextPicture = nextStill || (anime && showArtSettled && !nextStillPending ? backdropOf(anime, showArt, true) : undefined);

  // Episodes that aren't out yet are listed (locked, with their date) but never played.
  const currentEpLocked = !!currentEpisodeObj?.upcoming;
  const nextEpLocked = !!nextEpisodeObj?.upcoming;

  // Check whether the active episode has English Dub available
  const currentEpHasDub = useMemo(() => {
    if (currentEpisodeObj?.hasDub !== undefined) return Boolean(currentEpisodeObj.hasDub);
    if (typeof epData?.dubCount === 'number' && epData.dubCount > 0) return currentEp <= epData.dubCount;
    if (anime?.languages?.dub === 'full') return true;
    if (anime?.languages?.dub === 'partial') return currentEp <= 1;
    return false;
  }, [currentEpisodeObj?.hasDub, epData?.dubCount, currentEp, anime?.languages?.dub]);

  // Save progress to library once per episode (initially marked as in-progress)
  useEffect(() => {
    if (!anime || currentEp <= 0) return;
    const key = `${anime.id}:${currentSeason}:${currentEp}`;
    lastProgressCompletedRef.current = false;
    lastProgressSavedTimeRef.current = 0;
    if (recordedEpRef.current === key) return;
    recordedEpRef.current = key;

    const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
    setProgress(anime, currentEp, total, { completed: false, time: 0 });
  }, [anime, currentSeason, currentEp, epData?.episodes?.length, setProgress]);

  // Persist progress when exiting the screen
  useEffect(() => {
    return () => {
      if (anime && currentEp > 0) {
        const time = currentTimeRef.current;
        const dur = durationRef.current;
        const isCompleted = dur > 0 ? time / dur >= 0.85 : false;
        const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
        setProgress(anime, currentEp, total, {
          time: Math.floor(time),
          duration: Math.floor(dur),
          completed: isCompleted || lastProgressCompletedRef.current,
        });
      }
    };
  }, [anime, currentEp, epData, setProgress]);

  // Start finding the stream the moment the screen opens, while the details below
  // load: the lookup further down then shares this answer instead of starting late.
  const startedAtRef = useRef(Date.now());
  useEffect(() => {
    startedAtRef.current = Date.now();
    const seasonId = initialEps?.seasons?.find((x) => x.season_number === currentSeason)?.anilistId;
    const target = seasonId || (currentSeason === 1 ? initialAnilistId : undefined);
    api.prewarmStream(target, currentEp, preferredAudioLang === 'japanese' ? 'sub' : 'dub');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeason, currentEp]);

  // Caching stream resolver: reuses cached resolution and prevents duplicate concurrent requests
  const resolveStreamWithCache = useCallback(
    async (
      title: string,
      romaji: string | undefined,
      season: number,
      episode: number,
      mode: 'sub' | 'dub',
      seasonAnilistId?: number,
      force = false,
    ) => {
      const targetAnilistId =
        seasonAnilistId ||
        anime?.anilistId ||
        initialAnilistId ||
        undefined;
      const prefAudio = (preferredAudioNameRef.current || '').toLowerCase().trim();
      const key = `${id}:${targetAnilistId || ''}:${title}:${season}:${episode}:${mode}:${prefAudio}`;
      if (!force) {
        const hit = streamCacheRef.current.get(key);
        if (hit && Date.now() < hit.expiresAt && !isStreamUrlExpired(hit.data.streamUrl)) {
          return hit.data;
        }
        if (hit) {
          streamCacheRef.current.delete(key);
        }
      }

      const running = inflightResolutionsRef.current.get(key);
      if (running) return running;

      const promise = (async () => {
        try {
          const res = await api.resolveStream(
            { id, anilistId: targetAnilistId, title, romaji, season, episode, mode, preferredAudio: prefAudio },
            { forceRefresh: force },
          );
          if (res && res.streamUrl && isMainStream(res)) {
            streamCacheRef.current.set(key, { data: res, expiresAt: Date.now() + 15 * 60 * 1000 });
          }
          return res;
        } finally {
          inflightResolutionsRef.current.delete(key);
        }
      })();

      inflightResolutionsRef.current.set(key, promise);
      return promise;
    },
    [id, anime?.anilistId],
  );

  // Resolve stream URL for current episode/season
  useEffect(() => {
    if (currentEpLocked) return; // not out yet: nothing to load
    if (!detailSettled || (episodesLoading && !epData)) return;
    if (!playerPreferencesLoaded || (!anime?.title && !initialAnime?.title && !initialAnilistId)) return;
    // If the saved preference is Dub and anime-level metadata does not say
    // whether Dub exists, wait for episode metadata instead of resolving Sub
    // first and immediately issuing a second resolver request for Dub.
    const prefersHindi = preferredAudioNameRef.current?.includes('hindi');
    const dubAvailabilityUnknown =
      !prefersHindi &&
      currentLangRef.current === 'dub' &&
      anime?.languages?.dub !== 'full' &&
      anime?.languages?.dub !== 'partial' &&
      !epData;
    if (dubAvailabilityUnknown) return;

    const episodeKey = `${currentSeason}:${currentEp}`;
    // If this episode is already actively mounted and has a valid streamUrl,
    // do not restart the video or re-resolve just because background epData re-rendered!
    if (mountedStreamEpisodeKeyRef.current === episodeKey && mountedStream?.streamUrl) {
      return;
    }

    let cancelled = false;
    currentEpisodeKeyRef.current = episodeKey;
    const reqSeq = ++episodeRequestSeqRef.current;

    // Detach previous episode stream immediately if episode key changed
    if (mountedStreamEpisodeKeyRef.current !== episodeKey) {
      setMountedStream(null);
      setAvailableAudioTracks([]);
      setNativeAudioTrackId(null);
      setCurrentAudioTrackId(0);
    }

    // Target mode: prefer user preference (Hindi or English Dub), otherwise default to sub
    const targetMode = prefersHindi || (currentLangRef.current === 'dub' && currentEpHasDub) ? 'dub' : 'sub';
    if (targetMode !== currentLangRef.current) {
      setCurrentLang(targetMode);
      currentLangRef.current = targetMode;
    }

    setResolvingHls(true);
    setHlsError(null);

    const currentSeasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
    const seasonAnilistId =
      currentSeasonObj?.anilistId ||
      (currentSeasonObj?.id && !isNaN(Number(currentSeasonObj.id)) ? Number(currentSeasonObj.id) : undefined) ||
      anime?.anilistId ||
      initialAnilistId ||
      undefined;
    const targetTitle =
      (currentSeasonObj?.title && !/^Season\s+\d+$/i.test(currentSeasonObj.title.trim())
        ? currentSeasonObj.title
        : null) ||
      anime?.title ||
      initialAnime?.title ||
      '';

    resolveStreamWithCache(
      targetTitle,
      anime?.titleRomaji || initialAnime?.titleRomaji || undefined,
      currentSeason,
      currentEp,
      targetMode,
      seasonAnilistId,
      retryNonce > 0,
    )
      .then((res) => {
        if (cancelled || reqSeq !== episodeRequestSeqRef.current || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        if (res && res.streamUrl) {
          const resolvedEpisodeKey = `${currentSeason}:${currentEp}`;
          if (mountedStreamEpisodeKeyRef.current !== resolvedEpisodeKey) {
            const newEpisodeSourceKey = `${resolvedEpisodeKey}:${res.mode}:${res.streamUrl}`;
            setResumeAfterSourceChange({ key: newEpisodeSourceKey, time: 0, shouldPlay: true });
          }
          setHlsStream(res);
          mountedStreamEpisodeKeyRef.current = resolvedEpisodeKey;
          setMountedStream(res);
          setHlsError(null);

          if (!isMainStream(res)) {
            // The backup has one language: say the true one, and keep trying for the
            // main server behind the scenes (it picks up from the same moment).
            setCurrentLang(res.mode);
            currentLangRef.current = res.mode;
            retryMainServer(false);
          }
        } else {
          setHlsError('This episode could not load. Check your connection and try again.');
        }
      })
      .catch((err) => {
        if (cancelled || reqSeq !== episodeRequestSeqRef.current || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        setHlsError('This episode could not load. Check your connection and try again.');
      })
      .finally(() => {
        if (!cancelled && reqSeq === episodeRequestSeqRef.current && currentEpisodeKeyRef.current === `${currentSeason}:${currentEp}`) {
          setResolvingHls(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentEpLocked, detailSettled, episodesLoading, retryNonce, playerPreferencesLoaded, anime?.title, anime?.titleRomaji, anime?.languages?.dub, epData, currentSeason, currentEp, currentEpHasDub, resolveStreamWithCache]);

  useEffect(() => {
    if (detailQ.isError && !anime?.title && !initialAnilistId) setHlsError('This episode could not load. Check your connection and try again.');
  }, [detailQ.isError, anime?.title, initialAnilistId]);

  // Errors show only if they last: a problem the player recovers from by itself
  // (fresh link, backup server) never flashes on screen.
  const [shownError, setShownError] = useState<string | null>(null);
  useEffect(() => {
    if (!hlsError) {
      setShownError(null);
      return;
    }
    const t = setTimeout(() => setShownError(hlsError), 1500);
    return () => clearTimeout(t);
  }, [hlsError]);

  // Alternate Sub/Dub streams are resolved on demand instead of during cold
  // start. Eager prefetch ran before HLS reported in-band audio tracks, creating
  // an unnecessary second resolver request for many episodes. The resolver
  // cache and in-flight deduplication still apply when the user changes audio.

  // Show opening Content Advisory badge for 6 seconds on episode start
  useEffect(() => {
    setShowAdvisory(true);
    if (advisoryTimer.current) clearTimeout(advisoryTimer.current);
    advisoryTimer.current = setTimeout(() => {
      setShowAdvisory(false);
    }, 6000);
    return () => {
      if (advisoryTimer.current) clearTimeout(advisoryTimer.current);
    };
  }, [currentEp, currentSeason]);

  // Auto-hide controls overlay
  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setControlsVisible(true);
    hideControlsTimer.current = setTimeout(() => {
      setIsPlaying((playing) => {
        if (playing) {
          setControlsVisible(false);
        }
        return playing;
      });
    }, 3800);
  }, []);

  // The overlay fades its controls itself, in the same frame as the tap, and
  // reports here afterwards.
  const holdControls = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
  }, []);
  const onControlsHidden = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setControlsVisible(false);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [resetHideTimer]);

  const lastSeekSentRef = useRef(0);
  const queuedSeekRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (queuedSeekRef.current) clearTimeout(queuedSeekRef.current);
    },
    [],
  );
  const seekNativePlayer = useCallback(
    (time: number) => {
      const target = Math.max(0, time);
      nativeSeekTargetRef.current = target;
      seekStartedAtRef.current = Date.now();
      nativePlayerTimeRef.current = target;
      currentTimeRef.current = target;
      playbackTime.value = target;
      // Tapping +10 quickly: the first seek goes now, and the rest wait to become
      // one, so the player isn't made to drop what it's doing for each tap.
      const wait = 200 - (Date.now() - lastSeekSentRef.current);
      if (wait <= 0) {
        lastSeekSentRef.current = Date.now();
        nativeVideoRef.current?.seek?.(target);
      } else if (!queuedSeekRef.current) {
        queuedSeekRef.current = setTimeout(() => {
          queuedSeekRef.current = null;
          lastSeekSentRef.current = Date.now();
          nativeVideoRef.current?.seek?.(nativePlayerTimeRef.current);
        }, wait);
      }
    },
    [playbackTime],
  );

  // Controls Actions
  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => { isPlayingRef.current = !prev; return !prev; });
    resetHideTimer();
  }, [resetHideTimer]);

  const handleSeekBy = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, nativePlayerTimeRef.current + delta));
      seekNativePlayer(next);
    },
    [duration, seekNativePlayer],
  );

  const handleSeek = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(duration, targetSec));
      seekNativePlayer(clamped);
      resetHideTimer();
    },
    [duration, seekNativePlayer, resetHideTimer],
  );

  const handleSetSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed); playbackSpeedRef.current = speed;
  }, []);


  // Switch Audio Track
  // Path A: in-place Hls.js audioTrack switch when real alternate tracks exist in manifest
  // Path B: separate-stream fallback preserving position, state, speed, quality, subtitles
  const handleSelectAudio = useCallback(
    async (selection: { type: 'in-band'; trackId: number } | { type: 'separate'; mode: 'sub' | 'dub' }) => {
      if (selection.type === 'in-band') {
        // An in-band selection supersedes any outstanding separate-stream request.
        audioSwitchRequestRef.current += 1;
        setIsSwitchingAudio(false);
        setCurrentAudioTrackId(selection.trackId);
        setNativeAudioTrackId(selection.trackId);
        const track = availableAudioTracks.find((t) => t.id === selection.trackId);
        if (track) {
          showBadge(`Audio: ${track.name || track.lang}`);
          const trackName = (track.name || track.lang || '').toLowerCase();
          preferredAudioNameRef.current = trackName;
          sessionAudioOverrideRef.current = trackName;
          AsyncStorage.setItem('@animeverse:preferred_audio_name', trackName).catch(() => {});
        }
        return;
      }

      // Separate Sub/Dub stream fallback. A newer choice invalidates any older
      // resolver result so rapid taps cannot apply audio from an earlier choice.
      const requestId = ++audioSwitchRequestRef.current;
      const requestedEpisodeKey = `${currentSeason}:${currentEp}`;
      const targetMode = selection.mode;
      if (targetMode === currentLang) {
        setIsSwitchingAudio(false);
        return;
      }

      if (targetMode === 'dub' && !currentEpHasDub) {
        showBadge('English Dub not available for this episode');
        return;
      }

      setIsSwitchingAudio(true);
      showBadge(`Preparing ${targetMode === 'dub' ? 'English Dub' : 'Japanese (Sub)'}...`);

      try {
        const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
        const resolved = await resolveStreamWithCache(
          (seasonObj?.title && !/^Season\s+\d+$/i.test(seasonObj.title.trim()) ? seasonObj.title : null) || anime!.title,
          anime!.titleRomaji || undefined,
          currentSeason,
          currentEp,
          targetMode,
          seasonObj?.anilistId || anime!.anilistId || undefined,
        );

        // Guard against episode changes and newer audio selections.
        if (requestId !== audioSwitchRequestRef.current || currentEpisodeKeyRef.current !== requestedEpisodeKey) return;

        if (!resolved || !resolved.streamUrl) {
          throw new Error(`Could not load ${targetMode.toUpperCase()} stream`);
        }

        const capturedTime = nativePlayerTimeRef.current || currentTimeRef.current;
        const switchKey = `${requestedEpisodeKey}:${targetMode}:${resolved.streamUrl}`;
        setResumeAfterSourceChange({ key: switchKey, time: capturedTime, shouldPlay: isPlayingRef.current });
        mountedStreamEpisodeKeyRef.current = requestedEpisodeKey;
        // Keep the existing player surface and custom controls mounted while
        // ExoPlayer replaces the source. The resolver spinner is only for the
        // initial URL lookup; actual media loading is shown by isBuffering.
        setResolvingHls(false);
        setIsBuffering(true);
        setMountedStream(resolved);

        setCurrentLang(targetMode);
        currentLangRef.current = targetMode;
        sessionAudioOverrideRef.current = targetMode === 'dub' ? 'english' : 'japanese';
        preferredAudioNameRef.current = targetMode === 'dub' ? 'english' : 'japanese';
        setHlsStream(resolved);
        try {
          AsyncStorage.setItem('animeverse_lang', targetMode).catch(() => {});
        } catch {}
        showBadge(`Audio: ${targetMode === 'dub' ? 'English (Dub)' : 'Japanese (Sub)'}`);
      } catch (err: any) {
        showBadge(err?.message || 'Failed to switch audio');
      } finally {
        if (requestId === audioSwitchRequestRef.current) setIsSwitchingAudio(false);
      }
    },
    [
      availableAudioTracks,
      currentLang,
      currentEpHasDub,
      anime,
      epData,
      currentSeason,
      currentEp,
      resolveStreamWithCache,
      showBadge,
    ],
  );

  const handleSelectQuality = useCallback((targetHeight: number) => {
    setSelectedQualityHeight(targetHeight);
    selectedQualityRef.current = targetHeight;
    sessionQualityOverrideRef.current = targetHeight;
    console.log(`[Player Quality] User switched quality to: ${targetHeight === -1 ? 'Auto' : `${targetHeight}p`}`);
    // Native HLS uses resolution-based track selection; the native engine chooses
    // the closest available resolution when exact variants differ.
    showBadge(targetHeight === -1 ? 'Quality: Auto' : `Quality: ${targetHeight}p`);
  }, [showBadge]);

  const handleToggleSubtitles = useCallback(
    (enable: boolean) => {
      setSubtitlesEnabled(enable);
      subtitlesEnabledRef.current = enable;
      showBadge(enable ? 'Subtitles On' : 'Subtitles Off');
    },
    [showBadge],
  );

  const handleNextEpisode = useCallback(() => {
    if (episodes.length === 0) return;
    const upcomingNext = episodes.find((e) => e.episode_number === currentEp + 1);
    if (upcomingNext?.upcoming) {
      showBadge(`Episode ${upcomingNext.episode_number} comes out ${airDateLabel(upcomingNext.airingAt)}`);
      return;
    }
    const maxEp = episodes[episodes.length - 1].episode_number;
    if (currentEp < maxEp) {
      if (anime) {
        lastProgressCompletedRef.current = true;
        const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
        setProgress(anime, currentEp, total, { completed: true });
      }
      const nextEp = currentEp + 1;
      setPlayingHeight(0);
      lastLoggedResolutionRef.current = '';
      currentEpisodeKeyRef.current = `${currentSeason}:${nextEp}`;
      mountedStreamEpisodeKeyRef.current = null;
      setMountedStream(null);
      setHlsStream(null);
      episodeRequestSeqRef.current += 1;
      audioSwitchRequestRef.current += 1;
      setIsSwitchingAudio(false);
      setResumeAfterSourceChange(null);
      nativePlayerTimeRef.current = 0;
      currentTimeRef.current = 0;
      isPlayingRef.current = true;
      setHlsError(null);
      setResolvingHls(true);
      setIsBuffering(true);
      setAvailableAudioTracks([]);
      setNativeAudioTrackId(null);
      setCurrentAudioTrackId(0);
      setCurrentEp(nextEp);
      playbackTime.value = 0;
      playbackBuffered.value = 0;
      setIsPlaying(true);
      resetHideTimer();
    }
  }, [currentEp, currentSeason, episodes, resetHideTimer, showBadge]);

  // Two-Finger Pinch-to-Zoom Gesture (Dynamic Fit / Fill like MX Player & YouTube)
  const handleTouchStart = useCallback((e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 2) {
      const [t1, t2] = e.nativeEvent.touches;
      initialPinchDistRef.current = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (e.nativeEvent.touches.length === 2 && initialPinchDistRef.current) {
        const [t1, t2] = e.nativeEvent.touches;
        const currentDist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
        const diff = currentDist - initialPinchDistRef.current;
        if (diff > 45 && fitMode !== 'cover') {
          changeFitMode('cover');
          initialPinchDistRef.current = currentDist;
        } else if (diff < -45 && fitMode !== 'contain') {
          changeFitMode('contain');
          initialPinchDistRef.current = currentDist;
        }
      }
    },
    [fitMode, changeFitMode],
  );

  const handleTouchEnd = useCallback(() => {
    initialPinchDistRef.current = null;
  }, []);


  // HiAnime streams go directly to ExoPlayer. The native source key uses the
  // episode key attached to the resolved stream, not the currently selected
  // episode, so a pending resolver result cannot relabel the previous source.
  const nativeStreamKey = mountedStream?.streamUrl
    ? `${mountedStreamEpisodeKeyRef.current || `${currentSeason}:${currentEp}`}:${mountedStream.mode}:${mountedStream.streamUrl}`
    : '';

  const nativeSubtitles = useMemo(() => (mountedStream?.subtitles || []).map((sub) => ({
    label: sub.label || sub.lang || 'English',
    lang: sub.lang || 'en',
    src: toFullUrl(sub.src),
    default: sub.default,
  })), [mountedStream?.subtitles]);

  useEffect(() => {
    if (!mountedStream?.streamUrl || !nativeStreamKey) return;
    if (nativeSourceKeyRef.current === nativeStreamKey) return;
    nativeSourceKeyRef.current = nativeStreamKey;

    // Immediately seed with all audio tracks discovered by the resolver (Hindi, English, etc.)
    let initialAudioId = 0;
    if (mountedStream.audioTracks && mountedStream.audioTracks.length > 0) {
      const seeded = mountedStream.audioTracks.map((track, idx) => ({
        id: idx,
        name: track.name || track.language || `Audio ${idx + 1}`,
        lang: track.language || '',
      }));
      setAvailableAudioTracks(seeded);
      setHasInBandAlternateAudio(seeded.length > 1);

      const pref = preferredAudioNameRef.current;
      if (pref && seeded.length > 1) {
        const match = seeded.find((t) => isAudioLanguageMatch(t.name, t.lang, pref));
        if (match) initialAudioId = match.id;
      }
    } else {
      setAvailableAudioTracks([]);
      setHasInBandAlternateAudio(false);
    }

    // Immediately activate the preferred audio track in UI
    setCurrentAudioTrackId(initialAudioId);
    // The player chooses by language from the real list; no track number from this
    // guess reaches it, since its numbering isn't the real one.
    setNativeAudioTrackId(null);

    // Immediately seed video qualities from resolver manifest if available
    if (mountedStream.videoLevels && mountedStream.videoLevels.length > 0) {
      setAvailableLevels(mountedStream.videoLevels);
    } else {
      setAvailableLevels([]);
    }

    // Immediately seed subtitles from stream if available
    if (mountedStream.subtitles && mountedStream.subtitles.length > 0) {
      setAvailableTextTracks(
        mountedStream.subtitles.map((sub, idx) => ({
          id: idx,
          name: sub.label || sub.lang || `Subtitle ${idx + 1}`,
          lang: sub.lang || '',
        })),
      );
    } else {
      setAvailableTextTracks([]);
    }

    setNativeTextTrackId(null);
    setIsBuffering(true);
    setHlsError(null);
  }, [
    mountedStream?.streamUrl,
    mountedStream?.audioTracks,
    mountedStream?.videoLevels,
    mountedStream?.subtitles,
    nativeStreamKey,
  ]);

  const onNativePlayerLoad = useCallback((loadedDuration: number) => {
    if (__DEV__) console.log(`[Player Speed] screen opened to video ready: ${Date.now() - startedAtRef.current} ms`);
    if (loadedDuration > 0) setDuration(loadedDuration);
    const pending = resumeAfterSourceChange;
    if (pending && pending.key === nativeSourceKeyRef.current) {
      if (pending.time > 0) {
        nativeVideoRef.current?.seek?.(pending.time);
        nativePlayerTimeRef.current = pending.time;
        currentTimeRef.current = pending.time;
        playbackTime.value = pending.time;
      }
      setIsPlaying(pending.shouldPlay);
      isPlayingRef.current = pending.shouldPlay;
      setResumeAfterSourceChange(null);
    }
    setIsBuffering(false);
    setResolvingHls(false);
  }, [resumeAfterSourceChange, playbackTime]);

  const onNativePlayerProgress = useCallback(
    (time: number, loadedDuration: number, playable: number, videoWidth?: number, videoHeight?: number) => {
      const seekTarget = nativeSeekTargetRef.current;
      if (seekTarget !== null && Math.abs(time - seekTarget) <= 1.5) {
        nativeSeekTargetRef.current = null;
        setIsBuffering(false);
      } else if (seekTarget !== null && Date.now() - seekStartedAtRef.current < 4000) {
        // Still seeking: the old position isn't news. Keep the target.
        if (loadedDuration > 0) setDuration(loadedDuration);
        playbackBuffered.value = playable;
        return;
      } else if (seekTarget !== null) {
        nativeSeekTargetRef.current = null;
      }
      nativePlayerTimeRef.current = time;
      currentTimeRef.current = time;
      playbackTime.value = time;
      if (time > 0) setHlsError(null);
      if (loadedDuration > 0) setDuration(loadedDuration);
      playbackBuffered.value = playable;

      if (videoHeight && videoHeight > 0) {
        const resKey = `${videoWidth || 0}x${videoHeight}`;
        if (resKey !== lastLoggedResolutionRef.current) {
          lastLoggedResolutionRef.current = resKey;
          setPlayingHeight(videoHeight);
          console.log(`[Native Media3 Stream] Active rendering resolution: ${resKey} (${videoHeight}p)`);
        }
      }

      // Track playback progress & mark episode completed if watched past 85%
      if (loadedDuration > 0 && time > 0) {
        durationRef.current = loadedDuration;
        const ratio = time / loadedDuration;
        const isCompleted = ratio >= 0.85;
        if (
          anime &&
          (isCompleted !== lastProgressCompletedRef.current ||
            Math.abs(time - lastProgressSavedTimeRef.current) >= 15)
        ) {
          lastProgressCompletedRef.current = isCompleted;
          lastProgressSavedTimeRef.current = time;
          const total = epData?.episodes?.length || anime?.episodes || anime?.episodeCount || null;
          setProgress(anime, currentEp, total, {
            time: Math.floor(time),
            duration: Math.floor(loadedDuration),
            completed: isCompleted,
          });
        }

        // Look up the next episode's stream 20 s into this one, so it starts quickly.
        const nextEp = currentEp + 1;
        const total = epData?.episodes?.length || anime?.episodes || anime?.episodeCount || 0;
        const nextKey = `${currentSeason}:${nextEp}`;
        if (time >= 20 && !nextEpLocked && nextEp <= total && prefetchedNextEpRef.current !== nextKey) {
          prefetchedNextEpRef.current = nextKey;
          const currentSeasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
          const seasonAnilistId =
            currentSeasonObj?.anilistId ||
            (currentSeasonObj?.id && !isNaN(Number(currentSeasonObj.id)) ? Number(currentSeasonObj.id) : undefined) ||
            anime?.anilistId ||
            undefined;
          const targetTitle =
            (currentSeasonObj?.title && !/^Season\s+\d+$/i.test(currentSeasonObj.title.trim())
              ? currentSeasonObj.title
              : null) ||
            anime?.title ||
            '';
          resolveStreamWithCache(
            targetTitle,
            anime?.titleRomaji || undefined,
            currentSeason,
            nextEp,
            currentLangRef.current,
            seasonAnilistId,
            false,
          ).catch(() => {});
        }
      }
    },
    [currentEp, currentSeason, epData, anime, resolveStreamWithCache, nextEpLocked, playbackTime, playbackBuffered],
  );

  const isAnimeRulzStream = Boolean(
    mountedStream?.source?.includes('Multi-Audio') ||
    mountedStream?.referer?.includes('animerulz') ||
    mountedStream?.streamUrl?.includes('animerulz') ||
    mountedStream?.referer?.includes('ravok') ||
    mountedStream?.streamUrl?.includes('ravok')
  );

  const isHiAnimeStream = Boolean(
    !isAnimeRulzStream && (
      mountedStream?.source?.toLowerCase().includes('fast stream') ||
      mountedStream?.referer?.toLowerCase().includes('megacloud') ||
      mountedStream?.referer?.toLowerCase().includes('hianime') ||
      mountedStream?.source?.toLowerCase().includes('hianime')
    )
  );

  const getAudioTrackLabel = useCallback(
    (rawName: string) => {
      const lower = rawName.toLowerCase();
      let base = rawName.replace(/\s*\((?:sub|dub)\)/gi, '').trim();
      if (lower.includes('japan')) base = 'Japanese';
      else if (lower.includes('hindi')) base = 'Hindi';
      else if (lower.includes('english')) base = 'English';
      else if (lower.includes('telugu')) base = 'Telugu';
      else if (lower.includes('tamil')) base = 'Tamil';
      else if (lower === 'und' || lower.includes('unknown') || !base) {
        base = isAnimeRulzStream ? 'Multi-Audio' : 'Japanese';
      }

      if (isAnimeRulzStream) {
        return base;
      }
      if (lower.includes('japan') || lower.includes('sub')) {
        return `${base} (Sub)`;
      }
      return `${base} (Dub)`;
    },
    [isAnimeRulzStream],
  );

  const onNativePlayerAudioTracks = useCallback((tracks: NativePlayerTrack[]) => {
    const unnamed = (name: string) => !name || /^(und|unknown|audio \d+)$/i.test(name.trim());
    const listed = tracks.filter((track) => track.type === 'audio');
    // A single nameless track (the backup's) is the language that was asked for.
    const audio = listed.length === 1 && unnamed(listed[0].name)
      ? [{ ...listed[0], name: currentLangRef.current === 'dub' ? 'English' : 'Japanese' }]
      : listed;
    // If native player reports 0 tracks during source initialization, preserve existing tracks!
    if (audio.length === 0) return;
    setAvailableAudioTracks(audio.map(({ id, name, lang }) => ({ id, name, lang })));
    setHasInBandAlternateAudio(audio.length > 1);
    if (audio.length > 0) {
      const activeTrack = audio.find((t) => t.selected);
      const pref = preferredAudioNameRef.current;
      const match = pref ? audio.find((t) => isAudioLanguageMatch(t.name, t.lang, pref)) : null;

      // Smart Fallback (Catch 1):
      // If preferred audio (e.g. Hindi) is NOT available in this anime,
      // gracefully fall back to active track or Japanese Sub
      const wanted =
        match ||
        activeTrack ||
        audio.find((track) =>
          isAudioLanguageMatch(track.name, track.lang, currentLangRef.current === 'dub' ? 'english' : 'japanese'),
        ) ||
        audio[0];

      const initial = wanted;
      if (initial) {
        setCurrentAudioTrackId(initial.id);
        // If ExoPlayer is NOT already playing the wanted track (e.g. initial auto selection picked a different language),
        // only then dispatch an explicit track override so we never disturb smooth playback:
        if (activeTrack && activeTrack.id !== initial.id) {
          setNativeAudioTrackId(initial.id);
        }
        // Only the main server's list can say a language doesn't exist.
        if (isAnimeRulzStream && pref && !match && (pref.includes('hindi') || pref === 'hin' || pref === 'hi')) {
          showBadge(`Audio: ${initial.name} (Hindi not available for this anime)`);
        } else if (!isAnimeRulzStream && mountedStream?.streamUrl) {
          showBadge(`Backup server: ${initial.name} only`);
        }
      }
    }
  }, [showBadge, isAnimeRulzStream, mountedStream?.streamUrl]);

  const onNativePlayerTextTracks = useCallback((tracks: NativePlayerTrack[]) => {
    const text = tracks.filter((track) => track.type === 'text');
    if (text.length > 0) {
      setAvailableTextTracks(text.map(({ id, name, lang }) => ({ id, name, lang })));
      if (nativeTextTrackId === null) {
        const english = text.find((track) => track.name.toLowerCase().includes('english'));
        setNativeTextTrackId((english || text[0]).id);
      }
    }
  }, [nativeTextTrackId]);

  const onNativePlayerVideoTracks = useCallback((tracks: NativeVideoLevel[]) => {
    const levels = tracks.filter((track) => track.height > 0).map((track) => ({
      index: track.index,
      height: track.height,
      width: track.width,
      bitrate: track.bitrate,
    }));
    // If native player reports 0 tracks during source initialization, preserve existing levels!
    if (levels.length === 0) return;
    setAvailableLevels(levels);
    const targetHeight = selectedQualityRef.current;
    if (targetHeight > 0 && levels.length > 0) {
      const match = levels.find((level) => level.height === targetHeight);
      const below = levels.filter((l) => l.height <= targetHeight).sort((x, y) => y.height - x.height);
      const chosenHeight = match ? targetHeight : (below[0] || levels[0])?.height;
      if (chosenHeight && chosenHeight !== selectedQualityRef.current) {
        selectedQualityRef.current = chosenHeight;
        setSelectedQualityHeight(chosenHeight);
        if (!match && levels[0]) {
          showBadge(`Quality: ${chosenHeight}p (Max available)`);
        }
      }
    }
  }, [showBadge]);

  // Smart server switch: the main (multi-language) server won't play this episode
  // or keeps stalling, so carry on from the same moment on the backup server.
  const backupTriedRef = useRef<Record<string, boolean>>({});
  const switchToBackup = useCallback(() => {
    const epKey = `${currentSeason}:${currentEp}`;
    if (backupTriedRef.current[epKey] || !mountedStream?.source?.toLowerCase().includes('multi')) return false;
    backupTriedRef.current[epKey] = true;
    const resumeAt = nativePlayerTimeRef.current || currentTimeRef.current;
    const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
    const title = (seasonObj?.title && !/^Season\s+\d+$/i.test(seasonObj.title.trim()) ? seasonObj.title : null) || anime?.title || '';
    setIsBuffering(true);
    showBadge('Switching server…');
    api
      .resolveBackup({ title, romaji: anime?.titleRomaji || undefined, season: currentSeason, episode: currentEp, mode: currentLangRef.current })
      .then((res) => {
        if (currentEpisodeKeyRef.current !== epKey || !res?.streamUrl) return;
        setResumeAfterSourceChange({ key: `${epKey}:${res.mode}:${res.streamUrl}`, time: resumeAt, shouldPlay: isPlayingRef.current });
        mountedStreamEpisodeKeyRef.current = epKey;
        setCurrentLang(res.mode);
        currentLangRef.current = res.mode;
        setHlsStream(res);
        setMountedStream(res);
        setHlsError(null);
      })
      .catch(() => {
        if (currentEpisodeKeyRef.current === epKey) setHlsError('This episode could not load. Check your connection and try again.');
      });
    return true;
  }, [currentSeason, currentEp, mountedStream?.source, epData, anime?.title, anime?.titleRomaji, showBadge]);

  // On the backup: ask the main server again, and if it answers, carry on there from
  // the same moment. Once by itself per episode (not after the main server's video
  // itself failed to play), or any time the viewer asks.
  const mainRetriedRef = useRef<Record<string, boolean>>({});
  const retryMainServer = useCallback(
    (asked: boolean) => {
      const epKey = `${currentSeason}:${currentEp}`;
      if (!asked && (mainRetriedRef.current[epKey] || backupTriedRef.current[epKey])) return;
      mainRetriedRef.current[epKey] = true;
      const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
      const anilistId = seasonObj?.anilistId || anime?.anilistId || initialAnilistId;
      if (!anilistId) {
        if (asked) showBadge('The main server has no match for this anime');
        return;
      }
      if (asked) {
        backupTriedRef.current[epKey] = false;
        showBadge('Trying the main server…');
      }
      api
        .resolveMain(anilistId, currentEp, currentLangRef.current)
        .then((res) => {
          if (currentEpisodeKeyRef.current !== epKey || !res?.streamUrl) return;
          setResumeAfterSourceChange({
            key: `${epKey}:${res.mode}:${res.streamUrl}`,
            time: nativePlayerTimeRef.current || currentTimeRef.current,
            shouldPlay: isPlayingRef.current,
          });
          mountedStreamEpisodeKeyRef.current = epKey;
          setHlsStream(res);
          setMountedStream(res);
          setHlsError(null);
        })
        .catch(() => {
          if (asked) showBadge("The main server isn't answering right now");
        });
    },
    [currentSeason, currentEp, epData, anime?.anilistId, initialAnilistId, showBadge],
  );

  // Stuck loading for 15 s on the main server: try the backup.
  useEffect(() => {
    if (!isBuffering || !isPlaying || !mountedStream?.streamUrl) return;
    const t = setTimeout(() => switchToBackup(), 15000);
    return () => clearTimeout(t);
  }, [isBuffering, isPlaying, mountedStream?.streamUrl, switchToBackup]);

  const onNativePlayerError = useCallback((message: string) => {
    const epKey = `${currentSeason}:${currentEp}`;
    const retries = playerRetryCountRef.current[epKey] || 0;
    // A fresh link on the same server comes first: the backup costs the viewer
    // every language but one.
    if (retries >= 1 && switchToBackup()) return;

    // Auto-recovery: If stream failed (e.g. token expired on replay or cached link revoked),
    // clear stale caches and fetch fresh signed stream URL automatically
    if (retries < 2) {
      playerRetryCountRef.current[epKey] = retries + 1;
      console.log(`[Player Recovery] Native error encountered on episode ${epKey}. Retrying with fresh stream (attempt ${retries + 1})...`);
      api.clearStreamCache({
        id,
        anilistId: anime?.anilistId || undefined,
        title: anime?.title || '',
        season: currentSeason,
        episode: currentEp,
        mode: currentLangRef.current,
      });
      streamCacheRef.current.clear();
      setIsBuffering(true);
      setResolvingHls(true);
      setHlsError(null);

      const currentSeasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
      const seasonAnilistId =
        currentSeasonObj?.anilistId ||
        (currentSeasonObj?.id && !isNaN(Number(currentSeasonObj.id)) ? Number(currentSeasonObj.id) : undefined) ||
        anime?.anilistId ||
        undefined;
      const targetTitle =
        (currentSeasonObj?.title && !/^Season\s+\d+$/i.test(currentSeasonObj.title.trim())
          ? currentSeasonObj.title
          : null) ||
        anime?.title ||
        '';

      resolveStreamWithCache(
        targetTitle,
        anime?.titleRomaji || undefined,
        currentSeason,
        currentEp,
        currentLangRef.current,
        seasonAnilistId,
        true, // force = true!
      )
        .then((res) => {
          if (res && res.streamUrl) {
            setResumeAfterSourceChange({
              key: `${epKey}:${res.mode}:${res.streamUrl}`,
              time: nativePlayerTimeRef.current || currentTimeRef.current,
              shouldPlay: isPlayingRef.current,
            });
            mountedStreamEpisodeKeyRef.current = epKey;
            setHlsStream(res);
            setMountedStream(res);
            setHlsError(null);
          } else {
            setHlsError('This episode could not load. Check your connection and try again.');
          }
        })
        .catch(() => {
          setHlsError('This episode could not load. Check your connection and try again.');
        })
        .finally(() => {
          setResolvingHls(false);
        });
      return;
    }

    setIsBuffering(false);
    setHlsError(message || 'Unable to play this stream');
    setResolvingHls(false);
  }, [currentSeason, currentEp, id, anime, epData, resolveStreamWithCache, switchToBackup]);


  // Interactive like / dislike toggles
  const handleToggleLike = useCallback(() => {
    if (liked) {
      setLiked(false);
      setLikeCount((c) => c - 1);
    } else {
      setLiked(true);
      setLikeCount((c) => c + 1);
      if (disliked) {
        setDisliked(false);
        setDislikeCount((c) => Math.max(0, c - 1));
      }
    }
  }, [liked, disliked]);

  const handleToggleDislike = useCallback(() => {
    if (disliked) {
      setDisliked(false);
      setDislikeCount((c) => Math.max(0, c - 1));
    } else {
      setDisliked(true);
      setDislikeCount((c) => c + 1);
      if (liked) {
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
      }
    }
  }, [disliked, liked]);


  // Active audio track name
  const currentAudioName = useMemo(() => {
    if (hasInBandAlternateAudio) {
      const track = availableAudioTracks.find((t) => t.id === currentAudioTrackId);
      return track?.name || track?.lang || 'Default Audio';
    }
    return currentLang === 'dub' ? 'English (Dub)' : 'Japanese (Sub)';
  }, [hasInBandAlternateAudio, availableAudioTracks, currentAudioTrackId, currentLang]);

  // Active subtitle track name (dynamic)
  const currentSubtitleName = useMemo(() => {
    if (!subtitlesEnabled) return 'Off';
    const track = availableTextTracks.find((t) => t.id === nativeTextTrackId);
    if (track) return track.name || track.lang;
    if (availableTextTracks.length > 0) return availableTextTracks[0].name || availableTextTracks[0].lang;
    return 'On';
  }, [subtitlesEnabled, availableTextTracks, nativeTextTrackId]);

  // Everything the settings sheet offers, with the current choice of each.
  const openSettings = useCallback((section?: string) => {
    setSettingsSection(section);
    setSettingsOpen(true);
    setControlsVisible(false);
  }, []);
  const openAllSettings = useCallback(() => openSettings(), [openSettings]);
  const settingsSections = useMemo<SheetSection[]>(() => {
    const qualityLevels = availableLevels
      .map((l) => l.height)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => b - a);
    return [
      {
        key: 'audio',
        title: 'Audio language',
        icon: 'mic',
        value: currentAudioName,
        options: hasInBandAlternateAudio
          ? availableAudioTracks.map((t) => ({
              key: String(t.id),
              label: t.name || t.lang,
              selected: currentAudioTrackId === t.id,
              onSelect: () => handleSelectAudio({ type: 'in-band', trackId: t.id }),
            }))
          : [
              { key: 'sub', label: 'Japanese', hint: 'Original audio with subtitles', selected: currentLang === 'sub', disabled: isSwitchingAudio, onSelect: () => handleSelectAudio({ type: 'separate', mode: 'sub' }) },
              {
                key: 'dub',
                label: 'English',
                hint: currentEpHasDub ? 'English dub' : 'Not dubbed for this episode',
                selected: currentLang === 'dub',
                disabled: !currentEpHasDub || isSwitchingAudio,
                onSelect: () => handleSelectAudio({ type: 'separate', mode: 'dub' }),
              },
              ...(mountedStream && !isAnimeRulzStream
                ? [{ key: 'main', label: 'More languages', hint: 'Try the main server again', selected: false, onSelect: () => retryMainServer(true) }]
                : []),
            ],
      },
      {
        key: 'subtitles',
        title: 'Subtitles',
        icon: 'cc',
        value: currentSubtitleName,
        emptyText: 'This video has no separate subtitles (they may be part of the picture).',
        options: [
          { key: 'off', label: 'Off', selected: !subtitlesEnabled, onSelect: () => handleToggleSubtitles(false) },
          ...availableTextTracks.map((t) => ({
            key: String(t.id),
            label: t.name || t.lang,
            selected: subtitlesEnabled && (nativeTextTrackId === t.id || (nativeTextTrackId === null && t.id === 0)),
            onSelect: () => {
              setSubtitlesEnabled(true);
              setNativeTextTrackId(t.id);
              subtitlesEnabledRef.current = true;
              showBadge(`Subtitles: ${t.name || t.lang}`);
            },
          })),
        ],
      },
      {
        key: 'quality',
        title: 'Quality',
        icon: 'spark',
        value:
          (selectedQualityHeight === -1 ? 'Auto' : `${selectedQualityHeight}p`) +
          (playingHeight && playingHeight !== selectedQualityHeight ? ` · now ${playingHeight}p` : ''),
        emptyText: 'Reading the qualities this video has…',
        options: [
          { key: 'auto', label: 'Auto', hint: 'Adjusts to your connection', selected: selectedQualityHeight === -1, onSelect: () => handleSelectQuality(-1) },
          ...qualityLevels.map((h) => ({ key: String(h), label: `${h}p`, hint: h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : undefined, selected: selectedQualityHeight === h, onSelect: () => handleSelectQuality(h) })),
        ],
      },
      {
        key: 'speed',
        title: 'Playback speed',
        icon: 'fastForward',
        value: playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}x`,
        options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => ({ key: String(v), label: v === 1 ? 'Normal' : `${v}x`, selected: playbackSpeed === v, onSelect: () => handleSetSpeed(v) })),
      },
      {
        key: 'fit',
        title: 'Screen fit',
        icon: 'aspectRatio',
        value: fitMode === 'contain' ? 'Fit' : fitMode === 'cover' ? 'Zoom' : 'Stretch',
        options: [
          { key: 'contain', label: 'Fit', hint: 'Whole picture, black bars if needed', selected: fitMode === 'contain', onSelect: () => changeFitMode('contain') },
          { key: 'cover', label: 'Zoom', hint: 'Fills the screen, edges may be cut', selected: fitMode === 'cover', onSelect: () => changeFitMode('cover') },
          { key: 'fill', label: 'Stretch', hint: 'Fills the screen, picture stretched', selected: fitMode === 'fill', onSelect: () => changeFitMode('fill') },
        ],
      },
      {
        key: 'autoplay',
        title: 'Autoplay next episode',
        icon: 'skip',
        value: autoplay ? 'On' : 'Off',
        toggle: {
          value: autoplay,
          onChange: (v: boolean) => {
            setAutoplay(v);
            AsyncStorage.setItem(AUTOPLAY_STORAGE_KEY, v ? '1' : '0').catch(() => {});
          },
        },
      },
    ];
  }, [
    availableLevels, currentAudioName, hasInBandAlternateAudio, availableAudioTracks, currentAudioTrackId, handleSelectAudio, currentLang, isSwitchingAudio,
    currentEpHasDub, currentSubtitleName, subtitlesEnabled, handleToggleSubtitles, availableTextTracks, nativeTextTrackId, showBadge, selectedQualityHeight,
    handleSelectQuality, playbackSpeed, handleSetSpeed, fitMode, changeFitMode, autoplay, playingHeight, mountedStream, isAnimeRulzStream, retryMainServer,
  ]);
  const quickChips = useMemo<QuickChip[]>(
    () => [
      { key: 'audio', icon: 'mic', label: currentAudioName },
      { key: 'subtitles', icon: 'cc', label: currentSubtitleName },
      { key: 'speed', icon: 'fastForward', label: playbackSpeed === 1 ? '1x' : `${playbackSpeed}x` },
      // The quality really on screen once known (e.g. "1080p"), else the choice.
      { key: 'quality', icon: 'spark', label: playingHeight ? `${playingHeight}p` : selectedQualityHeight === -1 ? 'Auto' : `${selectedQualityHeight}p` },
    ],
    [currentAudioName, currentSubtitleName, playbackSpeed, selectedQualityHeight, playingHeight],
  );

  // Under-Player Content Area (Crunchyroll Layout in Portrait). It only redraws
  // when something in it changes, never because of the player above it.
  const detailsPanel = useMemo(
    () => (
        <ScrollView
          style={styles.detailsScroll}
          contentContainerStyle={[styles.detailsContent, { paddingBottom: insets.bottom + 30 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Series Name in orange */}
          <Text style={styles.seriesName}>{displayTitle(anime, titleLang) || anime?.title || 'Anime'}</Text>

          {/* Episode Title (Big bold white text) */}
          <Text style={styles.episodeTitle}>
            E{currentEp} - {currentEpisodeObj?.name || `Episode ${currentEp}`}
          </Text>

          {/* Meta Badges (U/A 16+ • Dub | Sub) */}
          <View style={styles.metaRow}>
            <View style={styles.ageBadge}>
              <Text style={styles.ageBadgeText}>{anime?.contentRating || 'U/A 16+'}</Text>
            </View>
            <Text style={styles.metaDot}>•</Text>
            <PressableScale
              onPress={() => {
                openSettings('audio');
              }}
              style={styles.audioModesBadge}
            >
              <Text style={[styles.audioModesText, hasInBandAlternateAudio && { color: colors.accent }]}>
                {resolvingHls || !mountedStream || availableAudioTracks.length === 0
                  ? 'Audio ▾'
                  : availableAudioTracks.length > 1
                  ? `${availableAudioTracks.length} Audios ▾`
                  : isHiAnimeStream
                  ? 'Sub | Dub ▾'
                  : 'Audio ▾'}
              </Text>
            </PressableScale>
          </View>

          {/* Quick Audio Language Selector */}
          {resolvingHls || !mountedStream || availableAudioTracks.length === 0 ? (
            <View style={styles.quickAudioSection}>
              <View style={styles.quickAudioHeader}>
                <Icon name="mic" size={13} color={colors.accent} />
                <Text style={styles.quickAudioLabel}>AUDIO LANGUAGE</Text>
              </View>
              <View style={styles.quickAudioList}>
                <View style={[styles.quickAudioChip, { opacity: 0.85, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.quickAudioChipText}>
                    Connecting…
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.quickAudioSection}>
              <View style={styles.quickAudioHeader}>
                <Icon name="mic" size={13} color={colors.accent} />
                <Text style={styles.quickAudioLabel}>AUDIO LANGUAGE</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickAudioList}
              >
                {availableAudioTracks.map((track) => {
                  const isSel = currentAudioTrackId === track.id;
                  const rawName = track.name || track.lang || `Track ${track.id + 1}`;
                  const label = getAudioTrackLabel(rawName);
                  const lower = label.toLowerCase();
                  const flag =
                    lower.includes('hindi') ? '🇮🇳 ' :
                    lower.includes('japan') ? '🇯🇵 ' :
                    lower.includes('english') ? '🇬🇧 ' :
                    lower.includes('telugu') ? '🇮🇳 ' :
                    lower.includes('tamil') ? '🇮🇳 ' : '';

                  return (
                    <PressableScale
                      key={track.id}
                      onPress={() => handleSelectAudio({ type: 'in-band', trackId: track.id })}
                      style={[styles.quickAudioChip, isSel && styles.quickAudioChipActive]}
                    >
                      <Text style={[styles.quickAudioChipText, isSel && styles.quickAudioChipTextActive]}>
                        {flag}{label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Interaction Bar (👍 2.9K, 👎 18, ↓ Download, ⋮ More) */}
          <View style={styles.interactionRow}>
            <View style={styles.interactionLeft}>
              <PressableScale onPress={handleToggleLike} style={styles.actionBtn}>
                <Icon name="thumbUp" size={20} color={liked ? colors.accent : '#fff'} />
                <Text style={[styles.actionBtnText, liked && { color: colors.accent }]}>
                  {likeCount > 1000 ? `${(likeCount / 1000).toFixed(1)}K` : likeCount}
                </Text>
              </PressableScale>

              <PressableScale onPress={handleToggleDislike} style={styles.actionBtn}>
                <Icon name="thumbDown" size={20} color={disliked ? colors.accent : '#fff'} />
                <Text style={[styles.actionBtnText, disliked && { color: colors.accent }]}>{dislikeCount}</Text>
              </PressableScale>
            </View>

            <View style={styles.interactionRight}>
              <PressableScale
                onPress={() => Alert.alert('Saved', `${displayTitle(anime, titleLang) || anime?.title || 'Episode'} added to your offline library!`)}
                style={styles.actionIconOnlyBtn}
              >
                <Icon name="download" size={20} color="#fff" />
              </PressableScale>

              <PressableScale
                onPress={() => {
                  openSettings();
                }}
                style={styles.actionIconOnlyBtn}
              >
                <Icon name="more" size={20} color="#fff" />
              </PressableScale>
            </View>
          </View>

          {/* Episode Synopsis */}
          <Text style={styles.synopsisText}>
            {currentEpisodeObj?.overview ||
              anime?.synopsis ||
              'Mereoleona takes on the ancient demon and the Magic Knights rush to stop the Door to Hell from opening.'}
          </Text>

          {/* Content Advisory Section */}
          <View style={styles.advisorySection}>
            <Text style={styles.advisoryTitle}>Content Advisory</Text>
            <Text style={styles.advisoryRating}>{anime?.contentRating || 'U/A 16+'}</Text>
            <Text style={styles.advisoryDetails}>
              Sexualized Imagery, Smoking, Profanity, Suggestive Dialogue, Violence
            </Text>
          </View>

          {/* Next Episode Section */}
          {nextEpisodeObj && (
            <View style={styles.nextEpSection}>
              <View style={styles.nextEpHeader}>
                <View style={styles.nextEpTagPill}>
                  <Text style={styles.nextEpTagText}>UP NEXT</Text>
                </View>
                <Text style={styles.nextEpSeasonSub}>
                  {epData?.seasons?.find((s) => s.season_number === currentSeason)?.name || `Season ${currentSeason}`}
                </Text>
              </View>

              <PressableScale onPress={handleNextEpisode} style={[styles.nextEpCard, nextEpLocked && { opacity: 0.8 }]} scaleTo={0.98} haptic>
                <View style={styles.nextEpThumbWrap}>
                  <Image
                    source={{
                      uri: upNextPicture,
                    }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.65)']} style={StyleSheet.absoluteFill} />
                  <View style={styles.nextEpPlayIcon}>
                    <Icon name={nextEpLocked ? 'lock' : 'play'} size={13} color="#fff" />
                  </View>
                  <View style={styles.nextEpDurationBadge}>
                    <Text style={styles.nextEpDurationText}>{nextEpisodeObj.runtime || 24}m</Text>
                  </View>
                </View>

                <View style={styles.nextEpInfo}>
                  <Text style={styles.nextEpNumLabel}>
                    EPISODE {nextEpisodeObj.episode_number}
                    {nextEpLocked ? ` · COMING ${airDateLabel(nextEpisodeObj.airingAt).toUpperCase()}` : ''}
                  </Text>
                  <Text style={styles.nextEpTitle} numberOfLines={2}>
                    {nextEpisodeObj.name || `Episode ${nextEpisodeObj.episode_number}`}
                  </Text>
                  <View style={styles.nextEpMetaRow}>
                    {nextEpLocked ? null : <EpisodeBadges hasSub={nextEpisodeObj.hasSub !== false} hasDub={nextEpisodeObj.hasDub !== false} />}
                  </View>
                </View>

                <View style={styles.nextEpActionBtn}>
                  <Icon name="skip" size={18} color="#fff" />
                </View>
              </PressableScale>
            </View>
          )}

          {/* All Episodes Redirect Link */}
          <PressableScale
            onPress={() => router.push(('/anime/' + (anime?.id || id)) as any)}
            style={styles.allEpisodesButton}
            scaleTo={0.98}
            haptic
          >
            <Icon name="list" size={18} color={colors.accent} />
            <Text style={styles.allEpisodesButtonText}>View All Episodes</Text>
            <Icon name="right" size={14} color="rgba(255,255,255,0.4)" />
          </PressableScale>
        </ScrollView>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      insets.bottom, anime, titleLang, currentEp, currentEpisodeObj, openSettings, hasInBandAlternateAudio, resolvingHls, mountedStream, availableAudioTracks,
      isHiAnimeStream, currentAudioTrackId, getAudioTrackLabel, handleSelectAudio, handleToggleLike, liked, likeCount, handleToggleDislike, disliked, dislikeCount,
      nextEpisodeObj, epData, currentSeason, handleNextEpisode, nextEpLocked, upNextPicture, id,
    ],
  );

  return (
    <View
      style={styles.container}
      onLayout={onRootLayout}
    >
      <StatusBar style="light" />
      {/* Video player. Its size is worked out natively, in the same frame the
          screen turns, with no JavaScript in between: full width at 16:9, but
          never taller than the screen. In portrait that's the usual player
          under the status bar; in landscape it's capped at the screen's height,
          so it fills the screen and the details below get no room at all.
          (Switching sizes from JavaScript only after the turn is what left a
          second of wrong layout every time.) */}
      {/* The gap under the status bar, also sized natively: in portrait it's
          the status bar's height; in landscape the player needs the whole
          height, so this gives way and shrinks to nothing, in the same frame. */}
      <View style={[styles.statusGap, { height: topInset }]} />
      <View
        style={[styles.playerContainer, styles.playerFrame]}
        onLayout={(e) => {
          progressBarWidthRef.current = e.nativeEvent.layout.width;
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {mountedStream?.streamUrl ? (
            <NativeHlsPlayer
              ref={nativeVideoRef}
              uri={mountedStream.rawMasterUrl || toFullUrl(mountedStream.streamUrl)}
              referer={mountedStream.referer}
              paused={!isPlaying || resolvingHls}
              playbackRate={playbackSpeed}
              volume={volume}
              fitMode={fitMode}
              selectedQualityHeight={selectedQualityHeight}
              selectedAudioTrackId={nativeAudioTrackId}
              preferredAudioLanguage={preferredAudioLang}
              selectedTextTrackId={nativeTextTrackId}
              subtitlesEnabled={subtitlesEnabled}
              subtitles={nativeSubtitles}
              onLoad={onNativePlayerLoad}
              onProgress={onNativePlayerProgress}
              onBuffer={setIsBuffering}
              onAudioTracks={onNativePlayerAudioTracks}
              onTextTracks={onNativePlayerTextTracks}
              onVideoTracks={onNativePlayerVideoTracks}
              onEnd={() => {
                if (anime && currentEp > 0) {
                  lastProgressCompletedRef.current = true;
                  const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
                  setProgress(anime, currentEp, total, { completed: true });
                }
                if (autoplay) handleNextEpisode();
              }}
              onError={onNativePlayerError}
            />
          ) : null}

        {/* Not out yet: a lock and the date instead of a player. */}
        {currentEpLocked ? (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]}>
            <Icon name="lock" size={30} color={colors.accent} />
            <Text style={styles.placeholderError}>Episode {currentEp} is coming soon</Text>
            <Text style={[styles.placeholderError, { opacity: 0.7, marginTop: 2 }]}>{airDateLabel(currentEpisodeObj?.airingAt)}</Text>
          </View>
        ) : null}

        {/* Loading */}
        {resolvingHls && !currentEpLocked && (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]} pointerEvents="none" />
        )}

        {/* Couldn't load: say so, with a retry */}
        {!resolvingHls && shownError && !currentEpLocked && (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]}>
            <Icon name="info" size={32} color={colors.accent} />
            <Text style={styles.placeholderError}>{shownError}</Text>
            <PressableScale
              style={styles.switchServerBtn}
              onPress={() => {
                mountedStreamEpisodeKeyRef.current = null;
                backupTriedRef.current = {};
                playerRetryCountRef.current = {};
                setHlsError(null);
                if (detailQ.isError) detailQ.refetch();
                setRetryNonce((n) => n + 1);
              }}
            >
              <Text style={styles.switchServerText}>Try again</Text>
            </PressableScale>
          </View>
        )}

        {/* Dynamic Zoom / Fit Toast Badge (flashes in center of player) */}
        {badgeText && (
          <View style={styles.badgeToast} pointerEvents="none">
            <Text style={styles.badgeToastText}>{badgeText}</Text>
          </View>
        )}

        {/* Crunchyroll Opening Content Advisory Badge (Top-left inside player for first 6 seconds) */}
        {showAdvisory && !controlsVisible && !settingsOpen && (
          <View style={styles.openingAdvisoryWrap} pointerEvents="none">
            <View style={styles.ageBadgeSmall}>
              <Text style={styles.ageBadgeSmallText}>{anime?.contentRating || 'U/A 16+'}</Text>
            </View>
            <Text style={styles.openingAdvisoryText} numberOfLines={2}>
              Sexualized Imagery, Smoking, Profanity, Suggestive Dialogue, Violence
            </Text>
          </View>
        )}

        {/* Controls and gestures (tap, double-tap, brightness / volume drag, seek bar). */}
        {/* Stays mounted while settings are open: it holds the brightness set by
            dragging (unmounting it gave the screen back the phone's brightness). */}
        <PlayerOverlay
          visible={(controlsVisible && !settingsOpen) || !!shownError || currentEpLocked}
          locked={settingsOpen}
          failed={!!shownError || currentEpLocked}
          fullscreen={isFullscreenView}
          title={displayTitle(anime, titleLang) || anime?.title || 'AnimeVerse'}
          subtitle={`E${currentEp} · ${currentEpisodeObj?.name || `Episode ${currentEp}`}`}
          isPlaying={isPlaying}
          isBuffering={isBuffering || resolvingHls}
          time={playbackTime}
          duration={duration}
          buffered={playbackBuffered}
          volume={volume}
          insets={insets}
          chips={quickChips}
          menus={settingsSections}
          hasNext={!!nextEpisodeObj && !nextEpLocked}
          onControlsShown={resetHideTimer}
          onControlsHidden={onControlsHidden}
          onHoldControls={holdControls}
          onKeepAlive={resetHideTimer}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onSeekBy={handleSeekBy}
          onVolume={setVolume}
          onBack={isFullscreenView ? exitFullscreen : () => (router.canGoBack() ? router.back() : router.replace('/'))}
          onToggleFullscreen={toggleFullscreen}
          onCycleFit={cycleFitMode}
          onOpenSettings={openAllSettings}
          onNext={handleNextEpisode}
        />

      </View>

      {/* Under-Player Content Area (Crunchyroll Layout in Portrait). Always
          mounted: in fullscreen it simply has no room (rebuilding it on every
          exit from fullscreen was another source of the delay). */}
        {detailsPanel}

      <PlayerSettingsSheet
        open={settingsOpen}
        initialSection={settingsSection}
        sections={settingsSections}
        fullscreen={isFullscreenView}
        insets={insets}
        onClose={() => setSettingsOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  playerContainer: {
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
  },
  playerFrame: {
    width: '100%',
    minWidth: '100%', // stays full width when the height is capped (no narrowed "75%" player)
    aspectRatio: 16 / 9,
    maxHeight: '100%',
    flexShrink: 0, // never squeezed: the status gap and the details give way instead
  },
  statusGap: {
    flexShrink: 1,
    minHeight: 0,
  },
  playerPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0a0a0c',
  },
  placeholderText: {
    marginTop: 12,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  placeholderError: {
    marginTop: 12,
    color: colors.danger,
    fontFamily: fonts.bold,
    fontSize: 14,
    textAlign: 'center',
  },
  switchServerBtn: {
    marginTop: 14,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  switchServerText: {
    color: '#000',
    fontFamily: fonts.bold,
    fontSize: 13,
  },

  // On-Screen Toast Badge (e.g. "+10s", "-10s", "Fit to screen", "Zoomed to fill")
  badgeToast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 40,
  },
  badgeToastText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // Crunchyroll Opening Content Advisory Badge
  openingAdvisoryWrap: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  ageBadgeSmall: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  ageBadgeSmallText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 9.5,
  },
  openingAdvisoryText: {
    color: '#fff',
    fontFamily: fonts.regular,
    fontSize: 11,
    opacity: 0.9,
    flexShrink: 1,
  },

  // Integrated Controls Overlay (No flat dark veil; transparent center + edge gradients)
  controlsOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    zIndex: 20,
  },

  // Top Bar inside Player with gradient
  playerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
  },
  landscapeTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 16,
  },
  landscapeBackBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeSeriesTitle: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 15,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  landscapeEpTitle: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: fonts.regular,
    fontSize: 12.5,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  playerTopRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconCircleBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Center Controls
  centerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },
  centerIconBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 4,
  },
  centerPlayBtn: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 5,
  },
  centerPlayBtnLandscape: {
    width: 72,
    height: 72,
  },

  // Bottom Scrubber Bar with gradient
  playerBottomBar: {
    paddingHorizontal: 14,
    paddingTop: 24,
    paddingBottom: 6,
  },
  timecodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  timecodeText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 11,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  scrubberTouchArea: {
    height: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  scrubberBuffered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.45)', // Preloaded buffer bar!
  },
  scrubberProgress: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 5,
    marginLeft: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  scrubberThumbActive: {
    transform: [{ scale: 1.3 }],
    backgroundColor: '#fff',
  },
  scrubBubble: {
    position: 'absolute',
    top: -30,
    transform: [{ translateX: -24 }],
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  scrubBubbleText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 11,
  },

  // Playback Settings Screen Overlay (Crunchyroll Style in Portrait & Landscape)
  settingsScreenOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    zIndex: 50,
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    marginBottom: 8,
  },
  settingsBackBtn: {
    padding: 6,
  },
  settingsHeaderTitle: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 18,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  settingsLabel: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  settingsSubLabel: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 2,
  },
  settingsValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsValueText: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
  },

  // Under-Player Details Section
  detailsScroll: {
    flex: 1,
    backgroundColor: '#000',
  },
  detailsContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  seriesName: {
    color: colors.accent,
    fontFamily: fonts.bold,
    fontSize: 13,
    marginBottom: 4,
  },
  episodeTitle: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 20,
    lineHeight: 26,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  ageBadge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  ageBadgeText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 10.5,
  },
  metaDot: {
    color: colors.muted,
    fontSize: 12,
  },
  audioModesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  audioModesText: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  quickAudioSection: {
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quickAudioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  quickAudioLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.8,
  },
  quickAudioList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickAudioChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  quickAudioChipActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.18)',
    borderColor: colors.accent,
  },
  quickAudioChipText: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.75)',
  },
  quickAudioChipTextActive: {
    color: colors.accent,
    fontFamily: fonts.bold,
  },
  interactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    marginBottom: 14,
  },
  interactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  interactionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  actionBtnText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  actionIconOnlyBtn: {
    padding: 6,
  },
  synopsisText: {
    color: '#d0d0d0',
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 20,
  },
  advisorySection: {
    marginBottom: 24,
  },
  advisoryTitle: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 15,
  },
  advisoryRating: {
    color: colors.text2,
    fontFamily: fonts.bold,
    fontSize: 12,
    marginBottom: 2,
  },
  advisoryDetails: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  nextEpSection: {
    marginBottom: 20,
  },
  nextEpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  nextEpTagPill: {
    backgroundColor: 'rgba(255,100,10,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,100,10,0.3)',
  },
  nextEpTagText: {
    color: colors.accent,
    fontFamily: fonts.black,
    fontSize: 10.5,
    letterSpacing: 0.8,
  },
  nextEpSeasonSub: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  nextEpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 10,
    gap: 12,
  },
  nextEpThumbWrap: {
    width: 124,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextEpPlayIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextEpDurationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
  },
  nextEpDurationText: {
    color: '#fff',
    fontFamily: fonts.regular,
    fontSize: 9.5,
  },
  nextEpInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  nextEpNumLabel: {
    color: colors.accent,
    fontFamily: fonts.black,
    fontSize: 10.5,
    letterSpacing: 0.5,
  },
  nextEpTitle: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  nextEpMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  nextEpActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  allEpisodesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  allEpisodesButtonText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 14,
  },
});