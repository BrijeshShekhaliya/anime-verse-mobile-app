import AsyncStorage from '@react-native-async-storage/async-storage';
import { createScreenShape } from '@/lib/screenShape';
import { savedZoom } from '@/lib/videoZoom';
import { router, useLocalSearchParams } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  AppState,
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
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlayerOverlay, type QuickChip } from '@/components/player/PlayerOverlay';
import { PlayerSettingsSheet, type SheetSection } from '@/components/player/PlayerSettingsSheet';
import { BlurBehindMenu } from '@/components/player/BlurBehindMenu';
import NativeHlsPlayer, { isNativeMedia3Available, type NativePlayerTrack, type NativeVideoLevel } from '@/components/player/NativeHlsPlayer';
import { isAudioLanguageMatch } from '@/components/player/ExpoVideoHlsPlayer';
import { isStreamUrlExpired, mainLacksEpisode } from '@/services/animerulzClient';
import { isMainStream, lateMainFor, mainServerStatus } from '@/lib/streamRouter';
import { missingModes, modeForLanguage, pickAudioTrack, secondLanguageFor } from '@/lib/audioMatch';
import { isFinished, isRealEnd, resumePosition } from '@/lib/resume';
import { nearestHeight, qualityBadge, qualityLabel } from '@/lib/quality';
import { airDateLabel } from '@/lib/airDate';
import { EpisodeCard } from '@/components/EpisodeCard';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { api, toFullUrl } from '@/lib/api';
import { useLibrary } from '@/lib/library';
import { useSettings, displayTitle } from '@/lib/settings';
import { colors, fonts, radius } from '@/lib/theme';
import { useDetail, useEpisodeStill } from '@/lib/queries';
import { backdropOf, useArt } from '@/lib/artwork';
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

export { CrashScreen as ErrorBoundary } from '@/components/CrashScreen';

// Every change of stream after the first says why, in the Metro terminal.
const logStreamChange = (why: string) => {
  if (__DEV__) console.log(`[Player] stream changed: ${why}`);
};

export default function WatchScreen() {
  const { id, season: paramSeason, ep: paramEp } = useLocalSearchParams<{ id: string; season?: string; ep?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { titleLang, audioLang, audioLang2, quality: userQuality, viewEnhance, playerQuality, playerSpeed, playerFit, playerZoom, update: updateSettings } = useSettings();


  // The layout follows the screen's real shape, measured from this screen's own
  // root view, and nothing else. The window size from useWindowDimensions is not
  // trustworthy here: on this app it isn't updated when the screen turns (the
  // activity handles rotation itself), so it kept saying "portrait" in landscape
  // and "landscape" back in portrait. That stale size is what showed the
  // portrait player on a landscape screen, and the fullscreen player with black
  // bars on a portrait one. The root view's measured size is what is actually
  // on screen, so the layout switches the moment the turn lands, both ways.
  const [screen, setScreen] = useState({ w: width, h: height });
  // The controls hear about a turn from here, at once. Re-rendering this whole screen takes
  // hundreds of milliseconds, so that part runs behind them and never holds them up.
  const screenShape = useRef(createScreenShape(width > height)).current;
  const landedFull = useRef(width > height);
  // The same small store: the video behind hears of a menu without this screen re-rendering.
  const menuOpen = useRef(createScreenShape(false)).current;
  // The pinched size. Only in fullscreen, and only once the screen has really turned: going
  // in, it would otherwise show on the small player for a moment.
  const videoZoom = useSharedValue(savedZoom(playerZoom));
  const zoomApplied = useSharedValue(width > height);
  const videoZoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoomApplied.value ? videoZoom.value : 1 }] }));
  const saveZoom = useCallback((zoom: number) => updateSettings({ playerZoom: zoom }), [updateSettings]);
  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w <= 0 || h <= 0) return;
    if (__DEV__ && w > h !== landedFull.current) {
      landedFull.current = w > h;
      console.log(`[Rotate] screen turned ${Date.now() - screenShape.changedAt()} ms after the tap`);
    }
    screenShape.set(w > h);
    zoomApplied.value = w > h;
    startTransition(() => setScreen((p) => (p.w === Math.round(w) && p.h === Math.round(h) ? p : { w: Math.round(w), h: Math.round(h) })));
  }, [screenShape, zoomApplied]);
  // Only that measured size decides fullscreen. Layout events arrive in order
  // and always describe the frame on screen, so nothing can overwrite them with
  // an older answer. (Asking the phone for its orientation is asynchronous: the
  // answer to a question asked just before a turn could arrive after the turn's
  // own event and undo it, which made fullscreen work only some of the time.)
  const isFullscreenView = screen.w > screen.h;
  const topInset = Platform.OS === 'android' ? Math.max(insets.top, RNStatusBar.currentHeight || 0) : insets.top;

  const { setProgress, progress } = useLibrary();
  // Follows the tap at once; saved in the background.
  const [enhanced, setEnhanced] = useState(viewEnhance);
  useEffect(() => setEnhanced(viewEnhance), [viewEnhance]);

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
  const sessionAudioOverrideRef = useRef<string | null>(progress[String(id)]?.audio ?? null);
  const sessionQualityOverrideRef = useRef<number | null>(null);
  const preferredAudioLang = (sessionAudioOverrideRef.current || audioLang || 'hindi').toLowerCase();
  const secondAudioLang = secondLanguageFor(preferredAudioLang, audioLang2);
  const secondAudioRef = useRef<string>(secondAudioLang);
  secondAudioRef.current = secondAudioLang;

  const [currentSeason, setCurrentSeason] = useState<number>(Math.max(1, parseInt(paramSeason || '1', 10) || 1));
  const [currentEp, setCurrentEp] = useState<number>(Math.max(1, parseInt(paramEp || '1', 10) || 1));
  const [retryNonce, setRetryNonce] = useState(0); // bumped by "Try again"
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(false); // off until asked for
  const [fitMode, setFitMode] = useState<FitMode>(playerFit); // Default: contain (100% video visible, no crop)

  // Dynamic Audio Tracks & Quality from Hls.js stream
  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState<number>(0);
  const [hasInBandAlternateAudio, setHasInBandAlternateAudio] = useState<boolean>(false);
  const [currentLang, setCurrentLang] = useState<'sub' | 'dub'>('sub');
  const [playerPreferencesLoaded, setPlayerPreferencesLoaded] = useState<boolean>(true);
  const [isSwitchingAudio, setIsSwitchingAudio] = useState<boolean>(false);

  const [availableLevels, setAvailableLevels] = useState<VideoLevelInfo[]>([]);
  const [availableTextTracks, setAvailableTextTracks] = useState<TextTrackInfo[]>([]);
  const [selectedQualityHeight, setSelectedQualityHeight] = useState<number>(playerQuality ?? defaultQualityHeight); // Last chosen, else the default from Settings

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
  const [duration, setDuration] = useState<number>(0); // 0 until the player knows
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(playerSpeed);
  const [autoplay, setAutoplay] = useState<boolean>(true);

  // Settings
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [volume, setVolume] = useState<number>(1); // the player's own volume (drag up / down on the right)

  const nativeVideoRef = useRef<any>(null);
  const nativePlayerTimeRef = useRef(0);
  const nativeSeekTargetRef = useRef<number | null>(null);
  const seekStartedAtRef = useRef(0);
  const nativeSourceKeyRef = useRef<string | null>(null);
  const [nativeAudioTrackId, setNativeAudioTrackId] = useState<number | null>(null);
  const [nativeTextTrackId, setNativeTextTrackId] = useState<number | null>(null);
  const [resumeAfterSourceChange, setResumeAfterSourceChange] = useState<{ key: string; time: number; shouldPlay: boolean } | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Notes for development, marked DEV on screen. Every call is wrapped in if (__DEV__), so
  // their text isn't in a release build at all (tests/dev-only.test.mjs checks this).
  const [devNote, setDevNote] = useState<string | null>(null);
  const devNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDevNote = useCallback((text: string) => {
    setDevNote(text);
    if (devNoteTimer.current) clearTimeout(devNoteTimer.current);
    devNoteTimer.current = setTimeout(() => setDevNote(null), 1800);
  }, []);
  const savedProgressRef = useRef(progress);
  savedProgressRef.current = progress;
  const recordedEpRef = useRef<string | null>(null);
  const progressBarWidthRef = useRef<number>(width);

  const mountedStreamEpisodeKeyRef = useRef<string | null>(null);
  const audioSwitchRequestRef = useRef(0);

  // Live state refs to capture values synchronously during stream switches
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const lastProgressCompletedRef = useRef<boolean>(false);
  const lastProgressSavedTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(true);
  const playbackSpeedRef = useRef<number>(playerSpeed);
  const subtitlesEnabledRef = useRef<boolean>(false);
  const selectedQualityRef = useRef<number>(-1);
  const currentLangRef = useRef<'sub' | 'dub'>('sub');
  const preferredAudioNameRef = useRef<string | null>(null);
  const lastLoggedResolutionRef = useRef<string>('');
  const [playingHeight, setPlayingHeight] = useState(0); // the resolution actually on screen
  const [ruledOut, setRuledOut] = useState<string[]>([]); // "season:episode:mode" a server turned out not to have
  const nextStreamRef = useRef<{ episode: number; stream: StreamData } | null>(null);
  const [nextPreload, setNextPreload] = useState<string[] | null>(null);
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
    const initialMode = modeForLanguage(activeAudio, secondAudioRef.current);
    setCurrentLang(initialMode);
    currentLangRef.current = initialMode;

    // 2. Quality: Session override takes precedence over global setting
    const initialHeight = sessionQualityOverrideRef.current ?? playerQuality ?? defaultQualityHeight;
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
  }, [audioLang, audioLang2, defaultQualityHeight, playerQuality]);


  // Stale callback protection across episode/stream switches
  const currentEpisodeKeyRef = useRef<string>(`${currentSeason}:${currentEp}`);
  useEffect(() => {
    currentEpisodeKeyRef.current = `${currentSeason}:${currentEp}`;
  }, [currentSeason, currentEp]);

  // Integrated Orientation Control (immediate non-blocking request)
  const enterLandscape = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => screenShape.set(false));
  }, [screenShape]);

  // The app is portrait-only: leaving fullscreen locks portrait again (never
  // "unlock", which would let the whole app rotate and, with the phone held
  // sideways, bounce straight back into fullscreen).
  const restoreOrientation = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => screenShape.set(true));
  }, [screenShape]);

  // Status and navigation bars switch the moment the button is tapped (not
  // after the screen has re-rendered, which can take most of a second).
  const setSystemBarsHidden = useCallback((hidden: boolean) => {
    RNStatusBar.setHidden(hidden, 'none');
    if (Platform.OS === 'android') NavigationBar.setVisibilityAsync(hidden ? 'hidden' : 'visible').catch(() => {});
  }, []);

  const enterFullscreen = useCallback(() => {
    // Bars and controls go now; the layout follows the turn natively.
    setSystemBarsHidden(true);
    screenShape.set(true);
    enterLandscape();
  }, [enterLandscape, setSystemBarsHidden, screenShape]);

  const exitFullscreen = useCallback(() => {
    // Same in reverse.
    setSystemBarsHidden(false);
    screenShape.set(false);
    restoreOrientation();
  }, [restoreOrientation, setSystemBarsHidden, screenShape]);

  const toggleFullscreen = useCallback(() => {
    if (screenShape.get()) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [screenShape, enterFullscreen, exitFullscreen]);

  // Controls hide while the screen turns (they reappear on the next tap). The overlay has
  // already hidden them itself; this only brings the screen's own record into line.
  useEffect(
    () =>
      screenShape.subscribe(() => {
        if (!screenShape.get()) zoomApplied.value = false;
        startTransition(() => setControlsVisible(false));
      }),
    [screenShape, zoomApplied],
  );

  // Leaving the app pauses the video, and coming back carries on, but only if it was playing.
  // The screen's own state changes too, so the play button can't disagree with the player.
  const resumeOnReturnRef = useRef(false);
  const savePositionRef = useRef<() => void>(() => {});
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        // Android can end the app any time from here on, with no warning.
        savePositionRef.current();
        if (isPlayingRef.current) {
          resumeOnReturnRef.current = isPlayingRef.current;
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
      }
      if (state === 'active' && resumeOnReturnRef.current) {
        resumeOnReturnRef.current = false;
        isPlayingRef.current = true;
        setIsPlaying(true);
      }
    });
    return () => sub.remove();
  }, []);
  // The system stopped it (a call, another app's sound): the button says so, and the viewer decides.
  const onSystemPause = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  // Handle hardware Android back button / back swipe
  useEffect(() => {
    const onBackPress = () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (screenShape.get()) {
        // Exit fullscreen to portrait instead of navigating away!
        exitFullscreen();
        return true;
      }
      return false; // In portrait, let default router back handle it
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [screenShape, settingsOpen, exitFullscreen]);

  // Keeps the bars matching the screen if it turned some other way (the
  // buttons already switched them at the tap; this repeats the same value).
  useEffect(() => {
    if (__DEV__ && screenShape.changedAt()) console.log(`[Rotate] rest of the screen ready ${Date.now() - screenShape.changedAt()} ms after the tap`);
    setSystemBarsHidden(isFullscreenView);
  }, [isFullscreenView, setSystemBarsHidden, screenShape]);

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

  // Fit / zoom / stretch for the video, with a short confirmation.
  const changeFitMode = useCallback(
    (newMode: FitMode) => {
      setFitMode(newMode);
      updateSettings({ playerFit: newMode });
      if (__DEV__) showDevNote(newMode === 'contain' ? 'Fit to screen' : newMode === 'cover' ? 'Zoomed to fill' : 'Stretch to screen');
    },
    [],
  );

  const toggleAutoplay = useCallback(() => {
    setAutoplay((on) => {
      AsyncStorage.setItem(AUTOPLAY_STORAGE_KEY, on ? '0' : '1').catch(() => {});
      return !on;
    });
  }, []);

  const cycleFitMode = useCallback(() => {
    if (fitMode === 'contain') changeFitMode('cover');
    else if (fitMode === 'cover') changeFitMode('fill');
    else changeFitMode('contain');
  }, [fitMode, changeFitMode]);

  const [detailsReady, setDetailsReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDetailsReady(true), 450);
    return () => clearTimeout(t);
  }, []);

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
  const { art: showArt, settled: showArtSettled } = useArt(detailsReady ? anime : null, true);
  const upNext = useEpisodeStill(detailsReady && nextEpisodeObj ? anime : null, currentSeason, nextEpisodeObj?.episode_number ?? 0, true);
  const thisEpisode = useEpisodeStill(detailsReady ? anime : null, currentSeason, currentEp, true);
  // Waits for TMDB's answer about the still, so the banner never shows first and gets swapped.
  const upNextPicture = upNext.still || (anime && showArtSettled && !upNext.pending ? upNext.thumb || backdropOf(anime, showArt, true) : undefined);

  // Episodes that aren't out yet are listed (locked, with their date) but never played.
  const currentEpLocked = !!currentEpisodeObj?.upcoming;
  const nextEpLocked = !!nextEpisodeObj?.upcoming;

  // Save progress to library once per episode (initially marked as in-progress)
  useEffect(() => {
    if (!anime || currentEp <= 0) return;
    const key = `${anime.id}:${currentSeason}:${currentEp}`;
    lastProgressCompletedRef.current = false;
    lastProgressSavedTimeRef.current = 0;
    if (recordedEpRef.current === key) return;

    const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
    const t = setTimeout(() => {
      recordedEpRef.current = key;
      setProgress(anime, currentEp, total, { season: currentSeason });
    }, 1500);
    return () => clearTimeout(t);
  }, [anime, currentSeason, currentEp, epData?.episodes?.length, setProgress]);

  // Persist progress when exiting the screen
  const savePosition = useCallback(() => {
    const time = currentTimeRef.current;
    // Left before anything played: what was saved stays as it was.
    if (anime && currentEp > 0 && time > 0) {
      const dur = durationRef.current;
      const isCompleted = isFinished(time, dur);
      const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
      setProgress(anime, currentEp, total, {
        season: currentSeason,
        time: Math.floor(time),
        duration: dur > 0 ? Math.floor(dur) : undefined,
        completed: isCompleted || lastProgressCompletedRef.current,
      });
    }
  }, [anime, currentSeason, currentEp, epData, setProgress]);
  savePositionRef.current = savePosition;
  useEffect(() => savePosition, [savePosition]);

  // Start finding the stream the moment the screen opens, while the details below
  // load: the lookup further down then shares this answer instead of starting late.
  const startedAtRef = useRef(Date.now());
  useEffect(() => {
    startedAtRef.current = Date.now();
    const seasonId = initialEps?.seasons?.find((x) => x.season_number === currentSeason)?.anilistId;
    const target = seasonId || (currentSeason === 1 ? initialAnilistId : undefined);
    api.prewarmStream(target, currentEp, modeForLanguage(preferredAudioLang, secondAudioLang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeason, currentEp]);

  const wantedMode = useCallback(() => modeForLanguage(preferredAudioNameRef.current, secondAudioRef.current), []);

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
  const lookedUpNonceRef = useRef(0);
  const quietRetriedRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (currentEpLocked) return; // not out yet: nothing to load
    if (!detailSettled || (episodesLoading && !epData)) return;
    if (!playerPreferencesLoaded || (!anime?.title && !initialAnime?.title && !initialAnilistId)) return;
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

    // What the viewer prefers; the answer's own mode says what the episode really has.
    const targetMode = wantedMode();
    if (targetMode !== currentLangRef.current) {
      setCurrentLang(targetMode);
      currentLangRef.current = targetMode;
    }

    setResolvingHls(true);
    setHlsError(null);
    const forceLookup = retryNonce !== lookedUpNonceRef.current;
    lookedUpNonceRef.current = retryNonce;

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
      forceLookup,
    )
      .then((res) => {
        if (cancelled || reqSeq !== episodeRequestSeqRef.current || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        if (res && res.streamUrl) {
          const resolvedEpisodeKey = `${currentSeason}:${currentEp}`;
          if (mountedStreamEpisodeKeyRef.current !== resolvedEpisodeKey) {
            const newEpisodeSourceKey = `${resolvedEpisodeKey}:${res.mode}:${res.streamUrl}`;
            const startAt = resumePosition(savedProgressRef.current[anime?.id ?? String(id)], currentSeason, currentEp);
            setResumeAfterSourceChange({ key: newEpisodeSourceKey, time: startAt, shouldPlay: true });
            if (__DEV__ && startAt > 0) showDevNote(`Resuming from ${formatDuration(startAt)}`);
          }
          setHlsStream(res);
          mountedStreamEpisodeKeyRef.current = resolvedEpisodeKey;
          setMountedStream(res);
          setHlsError(null);

          if (!isMainStream(res)) {
            // The backup has one language: say the true one. If the main server was only
            // slow, its answer still arrives and playback moves there from the same moment.
            setCurrentLang(res.mode);
            currentLangRef.current = res.mode;
            lateMainFor(res)?.then((main) => {
              if (main?.streamUrl) moveToMain(main, resolvedEpisodeKey);
            });
          }
        } else {
          setHlsError('This episode could not load. Check your connection and try again.');
        }
      })
      .catch(() => {
        if (cancelled || reqSeq !== episodeRequestSeqRef.current || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        if (!quietRetriedRef.current[episodeKey]) {
          // Often just a dropped signal: one quiet retry first, spinner still up.
          quietRetriedRef.current[episodeKey] = true;
          setIsBuffering(true);
          setTimeout(() => {
            if (currentEpisodeKeyRef.current === episodeKey) setRetryNonce((n) => n + 1);
          }, 2500);
          return;
        }
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
  }, [currentEpLocked, detailSettled, episodesLoading, retryNonce, playerPreferencesLoaded, anime?.title, anime?.titleRomaji, epData, currentSeason, currentEp, resolveStreamWithCache, wantedMode]);

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

  // Auto-hide controls overlay
  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setControlsVisible(true);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlayingRef.current) setControlsVisible(false);
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
    updateSettings({ playerSpeed: speed });
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
          if (__DEV__) showDevNote(`Audio: ${track.name || track.lang}`);
          const trackName = (track.name || track.lang || '').toLowerCase();
          preferredAudioNameRef.current = trackName;
          sessionAudioOverrideRef.current = trackName;
          if (anime) setProgress(anime, currentEp, epData?.episodes?.length || anime.episodes || anime.episodeCount || null, { season: currentSeason, audio: trackName });
          AsyncStorage.setItem('@animeverse:preferred_audio_name', trackName).catch(() => {});
        }
        return;
      }

      // Separate Sub/Dub stream fallback. A newer choice invalidates any older
      // resolver result so rapid taps cannot apply audio from an earlier choice.
      const requestId = ++audioSwitchRequestRef.current;
      const requestedEpisodeKey = `${currentSeason}:${currentEp}`;
      const targetMode = selection.mode;
      if (!isMainStream(mountedStream) && targetMode === mountedStream?.mode) {
        setIsSwitchingAudio(false);
        return;
      }

      setIsSwitchingAudio(true);
      if (__DEV__) showDevNote(`Switching to ${targetMode === 'dub' ? 'English' : 'Japanese'}…`);

      try {
        const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
        const resolved = await api.resolveBackup(
          {
            title: (seasonObj?.title && !/^Season\s+\d+$/i.test(seasonObj.title.trim()) ? seasonObj.title : null) || anime!.title,
            romaji: anime!.titleRomaji || undefined,
            season: currentSeason,
            episode: currentEp,
            mode: targetMode,
          },
          false,
        );

        // Guard against episode changes and newer audio selections.
        if (requestId !== audioSwitchRequestRef.current || currentEpisodeKeyRef.current !== requestedEpisodeKey) return;

        if (!resolved?.streamUrl || resolved.mode !== targetMode) {
          setRuledOut((r) => [...r, `${requestedEpisodeKey}:${targetMode}`]);
          if (__DEV__) showDevNote(`${targetMode === 'dub' ? 'English' : 'Japanese'} isn't available for this episode`);
          return;
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
        if (anime) setProgress(anime, currentEp, epData?.episodes?.length || anime.episodes || anime.episodeCount || null, { season: currentSeason, audio: sessionAudioOverrideRef.current });
        preferredAudioNameRef.current = targetMode === 'dub' ? 'english' : 'japanese';
        setHlsStream(resolved);
        if (__DEV__) showDevNote(`Audio: ${targetMode === 'dub' ? 'English (Dub)' : 'Japanese (Sub)'}`);
        try {
          AsyncStorage.setItem('animeverse_lang', targetMode).catch(() => {});
        } catch {}
      } catch (err) {
        // Stays on the language it was playing.
        if (__DEV__) showDevNote(err instanceof Error ? err.message : 'Failed to switch audio');
      } finally {
        if (requestId === audioSwitchRequestRef.current) setIsSwitchingAudio(false);
      }
    },
    [
      availableAudioTracks,
      mountedStream,
      anime,
      epData,
      currentSeason,
      currentEp,
    ],
  );

  const handleSelectQuality = useCallback((targetHeight: number) => {
    setSelectedQualityHeight(targetHeight);
    selectedQualityRef.current = targetHeight;
    sessionQualityOverrideRef.current = targetHeight;
    updateSettings({ playerQuality: targetHeight });
    // What's playing now is the old quality: the button shows the new one until it's on screen.
    setPlayingHeight(0);
    lastLoggedResolutionRef.current = '';
    console.log(`[Player Quality] User switched quality to: ${targetHeight === -1 ? 'Auto' : `${targetHeight}p`}`);
    if (__DEV__) showDevNote(targetHeight === -1 ? 'Quality: Auto' : `Quality: ${targetHeight}p`);
    // Native HLS uses resolution-based track selection; the native engine chooses
    // the closest available resolution when exact variants differ.
  }, []);

  const handleToggleSubtitles = useCallback(
    (enable: boolean) => {
      setSubtitlesEnabled(enable);
      subtitlesEnabledRef.current = enable;
      if (__DEV__) showDevNote(enable ? 'Subtitles On' : 'Subtitles Off');
    },
    [],
  );

  const handleNextEpisode = useCallback(() => {
    if (episodes.length === 0) return;
    const upcomingNext = episodes.find((e) => e.episode_number === currentEp + 1);
    if (upcomingNext?.upcoming) {
      if (__DEV__) showDevNote(`Episode ${upcomingNext.episode_number} comes out ${airDateLabel(upcomingNext.airingAt)}`);
      return;
    }
    const maxEp = episodes[episodes.length - 1].episode_number;
    if (currentEp < maxEp) {
      if (anime) {
        lastProgressCompletedRef.current = true;
        const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
        setProgress(anime, currentEp, total, { season: currentSeason, completed: true });
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
      setDuration(0);
      durationRef.current = 0;
      playbackTime.value = 0;
      playbackBuffered.value = 0;
      setIsPlaying(true);
      resetHideTimer();
    }
  }, [currentEp, currentSeason, episodes, resetHideTimer]);

  // HiAnime streams go directly to ExoPlayer. The native source key uses the
  // episode key attached to the resolved stream, not the currently selected
  // episode, so a pending resolver result cannot relabel the previous source.
  const nativeStreamKey = mountedStream?.streamUrl
    ? `${mountedStreamEpisodeKeyRef.current || `${currentSeason}:${currentEp}`}:${mountedStream.mode}:${mountedStream.streamUrl}`
    : '';

  // Starting stays true from opening the episode until the picture is really moving. The
  // steps along the way (lookup, player loading, language being set) each report "ready"
  // and "loading" separately, which flashed the spinner off and on between them.
  const [startedKey, setStartedKey] = useState('');
  const startProbeRef = useRef<{ key: string | null; time: number }>({ key: null, time: 0 });
  // The moment this stream was told to start at, until the player is seen to be there.
  const startSeekRef = useRef<number | null>(null);
  const startLoadedRef = useRef(false);
  const startTime = resumeAfterSourceChange?.key === nativeStreamKey ? resumeAfterSourceChange.time : 0;
  const isStarting = !currentEpLocked && !shownError && (!mountedStream?.streamUrl || startedKey !== nativeStreamKey);

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
    if (!isMainStream(mountedStream) && mountedStream.audioTracks && mountedStream.audioTracks.length > 0) {
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

    setPlayingHeight(0);
    lastLoggedResolutionRef.current = '';
    startLoadedRef.current = false;
    startSeekRef.current = startTime > 0 ? startTime : null;
    if (startTime > 0) {
      nativePlayerTimeRef.current = startTime;
      currentTimeRef.current = startTime;
      playbackTime.value = startTime;
    }
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
    startLoadedRef.current = true;
    const pending = resumeAfterSourceChange;
    if (pending && pending.key === nativeSourceKeyRef.current) {
      setIsPlaying(pending.shouldPlay);
      isPlayingRef.current = pending.shouldPlay;
      setResumeAfterSourceChange(null);
    }
    setIsBuffering(false);
    setResolvingHls(false);
  }, [resumeAfterSourceChange]);

  const onNativePlayerProgress = useCallback(
    (time: number, loadedDuration: number, playable: number, videoWidth?: number, videoHeight?: number) => {
      const sourceKey = nativeSourceKeyRef.current;
      if (startProbeRef.current.key !== sourceKey) startProbeRef.current = { key: sourceKey, time };
      else if (sourceKey && time > startProbeRef.current.time + 0.05) setStartedKey(sourceKey);

      const startAt = startSeekRef.current;
      if (startAt !== null) {
        if (Math.abs(time - startAt) <= 3) {
          startSeekRef.current = null;
        } else {
          if (startLoadedRef.current) {
            startSeekRef.current = null;
            seekNativePlayer(startAt);
          }
          return;
        }
      }

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
          if (__DEV__ && !isNativeMedia3Available() && selectedQualityRef.current > 0 && videoHeight < selectedQualityRef.current) showDevNote(`Expo Go dropped to ${videoHeight}p (the APK can't do this)`);
          console.log(`[Native Media3 Stream] Active rendering resolution: ${resKey} (${videoHeight}p)`);
        }
      }

      // Track playback progress & mark episode completed if watched past 85%
      if (loadedDuration > 0 && time > 0) {
        durationRef.current = loadedDuration;
        const isCompleted = isFinished(time, loadedDuration);
        if (__DEV__ && isCompleted && !lastProgressCompletedRef.current) console.log(`[Player] episode counted as finished at ${Math.floor(time)} of ${Math.floor(loadedDuration)} s`);
        if (
          anime &&
          (isCompleted !== lastProgressCompletedRef.current ||
            Math.abs(time - lastProgressSavedTimeRef.current) >= 15)
        ) {
          lastProgressCompletedRef.current = isCompleted;
          lastProgressSavedTimeRef.current = time;
          const total = epData?.episodes?.length || anime?.episodes || anime?.episodeCount || null;
          setProgress(anime, currentEp, total, {
            season: currentSeason,
            time: Math.floor(time),
            duration: Math.floor(loadedDuration),
            completed: isCompleted,
          });
        }

        // Look up the next episode's stream 20 s into this one, so it starts quickly.
        const nextEp = currentEp + 1;
        const total = epData?.episodes?.length || anime?.episodes || anime?.episodeCount || 0;
        const nextKey = `${currentSeason}:${nextEp}`;
        const upcoming = nextStreamRef.current;
        if (upcoming?.episode === nextEp && loadedDuration - time <= 120) {
          const address = upcoming.stream.rawMasterUrl || toFullUrl(upcoming.stream.streamUrl);
          setNextPreload((p) => (p?.[0] === address ? p : [address, upcoming.stream.referer || '']));
        }
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
            wantedMode(),
            seasonAnilistId,
            false,
          )
            .then((res) => {
              if (res?.streamUrl) nextStreamRef.current = { episode: nextEp, stream: res };
            })
            .catch(() => {});
        }
      }
    },
    [currentEp, currentSeason, epData, anime, resolveStreamWithCache, nextEpLocked, playbackTime, playbackBuffered, wantedMode, seekNativePlayer],
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

  const languageFallbackRef = useRef<(pref: string) => boolean>(() => false);
  const loggedTrackRef = useRef<string | null>(null);
  const checkedStreamRef = useRef<string | null>(null); // looks for a missing language once per stream
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

      // The first language, the second, Japanese, then English (see pickAudioTrack).
      const second = secondAudioRef.current;
      const initial = pickAudioTrack(audio, pref, second);
      if (__DEV__ && initial && mountedStream?.streamUrl && loggedTrackRef.current !== mountedStream.streamUrl) {
        loggedTrackRef.current = mountedStream.streamUrl;
        console.log(`[Player] languages: ${audio.map((t) => t.name).join(', ')} | wanted ${pref}, then ${second} | player was on ${activeTrack?.name ?? 'none yet'} | chosen ${initial.name}`);
      }
      if (initial) {
        setCurrentAudioTrackId(initial.id);
        // If ExoPlayer is NOT already playing the wanted track (e.g. initial auto selection picked a different language),
        // only then dispatch an explicit track override so we never disturb smooth playback:
        if (audio.length > 1 && activeTrack?.id !== initial.id) {
          setNativeAudioTrackId(initial.id);
        }
        if (__DEV__ && pref && !match && mountedStream?.streamUrl) {
          showDevNote(!isAnimeRulzStream && mainServerStatus().resting ? `Backup server: playing ${initial.name}` : `${pref} isn't on this episode: playing ${initial.name}`);
        }
        // The preference itself is left alone: the next episode tries it again. If this
        // stream lacks both languages, the backup may have them.
        if (isAnimeRulzStream && pref && !match && mountedStream?.streamUrl && checkedStreamRef.current !== mountedStream.streamUrl) {
          checkedStreamRef.current = mountedStream.streamUrl;
          const hasSecond = audio.some((t) => isAudioLanguageMatch(t.name, t.lang, second));
          if (!languageFallbackRef.current(pref) && !hasSecond) languageFallbackRef.current(second);
        }
      }
    }
  }, [isAnimeRulzStream, mountedStream?.streamUrl]);

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
  }, []);

  // Smart server switch: the main (multi-language) server won't play this episode
  // or keeps stalling, so carry on from the same moment on the backup server.
  const backupTriedRef = useRef<Record<string, boolean>>({});
  const switchToBackup = useCallback(() => {
    const epKey = `${currentSeason}:${currentEp}`;
    if (backupTriedRef.current[epKey] || !mountedStream?.source?.toLowerCase().includes('multi')) return false;
    backupTriedRef.current[epKey] = true;
    logStreamChange('main server stream failed or stalled, moving to the backup');
    if (__DEV__) showDevNote('Switching server…');
    const resumeAt = nativePlayerTimeRef.current || currentTimeRef.current;
    const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
    const title = (seasonObj?.title && !/^Season\s+\d+$/i.test(seasonObj.title.trim()) ? seasonObj.title : null) || anime?.title || '';
    setIsBuffering(true);
    api
      .resolveBackup({ title, romaji: anime?.titleRomaji || undefined, season: currentSeason, episode: currentEp, mode: wantedMode() })
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
  }, [currentSeason, currentEp, mountedStream?.source, epData, anime?.title, anime?.titleRomaji]);

  // Carry on from the same moment on the main server.
  const moveToMain = useCallback((res: StreamData, epKey: string) => {
    if (currentEpisodeKeyRef.current !== epKey || !res?.streamUrl) return;
    logStreamChange('moved to the main server');
    setResumeAfterSourceChange({
      key: `${epKey}:${res.mode}:${res.streamUrl}`,
      time: nativePlayerTimeRef.current || currentTimeRef.current,
      shouldPlay: isPlayingRef.current,
    });
    mountedStreamEpisodeKeyRef.current = epKey;
    setHlsStream(res);
    setMountedStream(res);
    setHlsError(null);
  }, []);

  // The viewer asks for the main server from the backup: one try, and the real
  // reason on screen if it says no.
  const retryMainServer = useCallback(() => {
    const epKey = `${currentSeason}:${currentEp}`;
    const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
    const anilistId = seasonObj?.anilistId || anime?.anilistId || initialAnilistId;
    if (!anilistId) {
      if (__DEV__) showDevNote('The main server has no match for this anime');
      return;
    }
    backupTriedRef.current[epKey] = false;
    if (__DEV__) showDevNote('Trying the main server…');
    setIsBuffering(true);
    api
      .resolveMain(anilistId, currentEp, wantedMode())
      .then((res) => moveToMain(res, epKey))
      // Stays where it is; Settings > Server shows why.
      .catch((e) => {
        setIsBuffering(false);
        if (__DEV__) showDevNote(`Main server: ${e instanceof Error ? e.message : 'no answer'}`);
      });
  }, [currentSeason, currentEp, epData, anime?.anilistId, initialAnilistId, moveToMain]);

  // The main server's episode lacks the wanted language, but the backup can carry
  // English and Japanese: move there, if it really has it, from the same moment.
  // (It never has Hindi, Tamil or Telugu, so those cost no request.)
  const languageTriedRef = useRef<Record<string, boolean>>({});
  languageFallbackRef.current = (pref: string) => {
    const mode = /english|^eng?$/.test(pref) ? 'dub' : /japan|^jpn$|^ja$/.test(pref) ? 'sub' : null;
    const epKey = `${currentSeason}:${currentEp}`;
    if (!mode || languageTriedRef.current[`${epKey}:${mode}`]) return false;
    // The main server's answer already said what exists: no request for what doesn't.
    if (mountedStream?.modes && !mountedStream.modes.includes(mode)) return false;
    languageTriedRef.current[`${epKey}:${mode}`] = true;
    const seasonObj = epData?.seasons?.find((s) => s.season_number === currentSeason);
    api
      .resolveBackup(
        {
          title: (seasonObj?.title && !/^Season\s+\d+$/i.test(seasonObj.title.trim()) ? seasonObj.title : null) || anime?.title || '',
          romaji: anime?.titleRomaji || undefined,
          season: currentSeason,
          episode: currentEp,
          mode,
        },
        false,
      )
      .then((res) => {
        if (currentEpisodeKeyRef.current !== epKey) return;
        if (!res?.streamUrl || res.mode !== mode) {
          setRuledOut((r) => [...r, `${epKey}:${mode}`]);
          if (__DEV__) showDevNote(`${mode === 'dub' ? 'English' : 'Japanese'} isn't on this episode`);
          return;
        }
        logStreamChange(`${pref} isn't on the main server, the backup has it`);
        setResumeAfterSourceChange({
          key: `${epKey}:${res.mode}:${res.streamUrl}`,
          time: nativePlayerTimeRef.current || currentTimeRef.current,
          shouldPlay: isPlayingRef.current,
        });
        mountedStreamEpisodeKeyRef.current = epKey;
        setCurrentLang(res.mode);
        currentLangRef.current = res.mode;
        setHlsStream(res);
        setMountedStream(res);
      })
      .catch(() => {
        if (__DEV__) showDevNote(`${mode === 'dub' ? 'English' : 'Japanese'} isn't on this episode`);
      });
    return true;
  };

  // Stuck loading for 15 s on the main server: try the backup.
  useEffect(() => {
    if ((!isBuffering && !isStarting) || !isPlaying || !mountedStream?.streamUrl) return;
    const t = setTimeout(() => switchToBackup(), 15000);
    // Still nothing on the screen: say so rather than spin for ever.
    const giveUp = isStarting
      ? setTimeout(() => {
          setIsBuffering(false);
          setHlsError('This episode could not load. Check your connection and try again.');
        }, 30000)
      : undefined;
    return () => {
      clearTimeout(t);
      if (giveUp) clearTimeout(giveUp);
    };
  }, [isBuffering, isStarting, isPlaying, mountedStream?.streamUrl, switchToBackup]);

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
      console.log(`[Player Recovery] Native error on episode ${epKey}: ${message}. Retrying with fresh stream (attempt ${retries + 1})...`);
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
        wantedMode(),
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


  // What this episode can really play in: the player's own list, or on a one-track
  // stream, what the server says it has. The player menu, the settings and the
  // screen below all show this one list, so they can't disagree.
  const languageChoices = useMemo(() => {
    const epKey = `${currentSeason}:${currentEp}`;
    const stillPossible = (m: 'sub' | 'dub') => !ruledOut.includes(`${epKey}:${m}`);
    const elsewhere = (m: 'sub' | 'dub') => ({
      key: `other-${m}`,
      label: m === 'dub' ? 'English (Dub)' : 'Japanese (Sub)',
      selected: false,
      disabled: isSwitchingAudio,
      onSelect: () => handleSelectAudio({ type: 'separate', mode: m }),
    });
    if (isAnimeRulzStream || availableAudioTracks.length > 1) {
      const carried = availableAudioTracks.map((t) => ({
        key: String(t.id),
        label: getAudioTrackLabel(t.name || t.lang || `Track ${t.id + 1}`),
        selected: currentAudioTrackId === t.id,
        disabled: false,
        onSelect: () => handleSelectAudio({ type: 'in-band', trackId: t.id }),
      }));
      // Nothing extra until the real list is in: "Connecting…" until then.
      if (!carried.length) return carried;
      return [...carried, ...missingModes(availableAudioTracks, mountedStream?.modes).filter(stillPossible).map(elsewhere)];
    }
    if (!mountedStream) return [];
    const modes = mountedStream.modes?.length ? mountedStream.modes : [mountedStream.mode];
    return modes
      .filter((m) => m === mountedStream.mode || stillPossible(m))
      .map((m) => ({ ...elsewhere(m), key: m, selected: mountedStream.mode === m }));
  }, [isAnimeRulzStream, availableAudioTracks, getAudioTrackLabel, currentAudioTrackId, handleSelectAudio, mountedStream, isSwitchingAudio, ruledOut, currentSeason, currentEp]);
  const currentAudioName = languageChoices.find((c) => c.selected)?.label ?? 'Connecting…';

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
  const toggleEnhance = useCallback(() => {
    const next = !enhanced;
    setEnhanced(next);
    updateSettings({ viewEnhance: next });
    if (__DEV__) showDevNote(!next ? 'View enhancement off' : isNativeMedia3Available() ? 'View enhancement on: sharpening + colour' : 'View enhancement on: colour only (Expo Go cannot sharpen)');
  }, [enhanced, updateSettings, showDevNote]);
  const realHeights = useMemo(() => [...new Set(availableLevels.map((l) => l.height))].sort((a, b) => b - a), [availableLevels]);
  const qualityText = qualityLabel(selectedQualityHeight, playingHeight, realHeights);
  const lockedHeight = selectedQualityHeight > 0 ? nearestHeight(realHeights, selectedQualityHeight) : -1;
  const settingsSections = useMemo<SheetSection[]>(() => {
    const mainLacks = mainLacksEpisode(epData?.seasons?.find((x) => x.season_number === currentSeason)?.anilistId || anime?.anilistId || initialAnilistId, currentEp);
    return [
      {
        key: 'audio',
        title: 'Audio language',
        icon: 'micLine',
        value: currentAudioName,
        emptyText: 'Reading the languages this episode has…',
        options: [
          ...languageChoices,
          ...(mountedStream && !isAnimeRulzStream && !mainLacks
            ? [{ key: 'main', label: 'More languages', hint: __DEV__ ? 'Try the main server again' : undefined, selected: false, onSelect: () => retryMainServer() }]
            : []),
        ],
      },
      // For testing: which server is playing and why. Not in release builds.
      ...(__DEV__
        ? ([
      {
        key: 'server',
        title: 'Server  ·  DEV',
        icon: 'shield',
        value: !mountedStream ? '…' : isAnimeRulzStream ? 'Main' : 'Backup',
        options: [
          {
            key: 'main',
            label: 'Main',
            hint: mainLacks ? "This episode isn't on it" : mainServerStatus().lastError ? `Last problem: ${mainServerStatus().lastError}` : 'All languages',
            selected: isAnimeRulzStream,
            disabled: mainLacks,
            onSelect: () => {
              if (!isAnimeRulzStream) retryMainServer();
            },
          },
          {
            key: 'backup',
            label: 'Backup',
            hint: 'Japanese and English',
            selected: !isAnimeRulzStream,
            onSelect: () => {
              if (!isAnimeRulzStream) return;
              backupTriedRef.current[`${currentSeason}:${currentEp}`] = false;
              switchToBackup();
            },
          },
        ],
      },
          ] as SheetSection[])
        : []),
      {
        key: 'subtitles',
        title: 'Subtitles',
        icon: 'ccLine',
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
              if (__DEV__) showDevNote(`Subtitles: ${t.name || t.lang}`);
            },
          })),
        ],
      },
      {
        key: 'quality',
        title: 'Quality',
        icon: 'spark',
        value:
          qualityText +
          // The choice, when the video or the player couldn't do it. For testing only.
          (__DEV__ && selectedQualityHeight > 0 && playingHeight > 0 && playingHeight !== selectedQualityHeight ? `  ·  DEV chose ${selectedQualityHeight}p` : ''),
        emptyText: 'Reading the qualities this video has…',
        options: [
          { key: 'auto', label: 'Auto', hint: 'Adjusts to your connection', selected: selectedQualityHeight === -1, onSelect: () => handleSelectQuality(-1) },
          ...realHeights.map((h) => ({ key: String(h), label: `${h}p`, hint: h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : undefined, selected: lockedHeight === h, onSelect: () => handleSelectQuality(h) })),
        ],
      },
      {
        key: 'speed',
        title: 'Playback speed',
        icon: 'gaugeLine',
        value: playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}x`,
        options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => ({ key: String(v), label: v === 1 ? 'Normal' : `${v}x`, selected: playbackSpeed === v, onSelect: () => handleSetSpeed(v) })),
      },
      ...(isFullscreenView
        ? ([
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
          ] as SheetSection[])
        : []),
      {
        key: 'enhance',
        title: 'View enhancement',
        icon: 'spark',
        value: enhanced ? 'On' : 'Off',
        toggle: { value: enhanced, onChange: toggleEnhance },
      },
      {
        key: 'autoplay',
        title: 'Autoplay next episode',
        icon: 'autoLine',
        value: autoplay ? 'On' : 'Off',
        toggle: {
          value: autoplay,
          onChange: toggleAutoplay,
        },
      },
    ];
  }, [
    availableLevels, currentAudioName, languageChoices, settingsOpen, switchToBackup, currentSeason, currentEp, currentSubtitleName, subtitlesEnabled, handleToggleSubtitles, availableTextTracks, nativeTextTrackId, selectedQualityHeight,
    handleSelectQuality, playbackSpeed, handleSetSpeed, fitMode, changeFitMode, autoplay, toggleAutoplay, playingHeight, mountedStream, isAnimeRulzStream, retryMainServer, epData, anime?.anilistId, initialAnilistId, isFullscreenView, enhanced, toggleEnhance,
    qualityText, realHeights, lockedHeight,
  ]);
  const quickChips = useMemo<QuickChip[]>(
    () => [
      { key: 'audio', icon: 'micLine', label: currentAudioName },
      { key: 'subtitles', icon: 'ccLine', label: currentSubtitleName },
      { key: 'speed', icon: 'gaugeLine', label: playbackSpeed === 1 ? '1x' : `${playbackSpeed}x` },
      // What's really playing, the same as the quality row in settings.
      { key: 'quality', icon: 'spark', label: qualityText, badge: qualityBadge(playingHeight || lockedHeight || 0) },
    ],
    [currentAudioName, currentSubtitleName, playbackSpeed, qualityText, playingHeight, lockedHeight],
  );

  const upNextThumbW = Math.round((Math.min(screen.w, screen.h) - 32) * 0.46);

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
            E{currentEp} - {thisEpisode.name}
          </Text>

          {/* Meta Badges: the rating when known, and the audio menu */}
          <View style={styles.metaRow}>
            {anime?.contentRating ? (
              <>
                <View style={styles.ageBadge}>
                  <Text style={styles.ageBadgeText}>{anime.contentRating}</Text>
                </View>
                <Text style={styles.metaDot}>•</Text>
              </>
            ) : null}
            <PressableScale
              onPress={() => {
                openSettings('audio');
              }}
              style={styles.audioModesBadge}
            >
              <Text style={[styles.audioModesText, languageChoices.length > 1 && { color: colors.accent }]}>
                {languageChoices.length > 1 ? `${languageChoices.length} Audios ▾` : 'Audio ▾'}
              </Text>
            </PressableScale>
            <PressableScale onPress={() => openSettings()} style={styles.moreBtn} hitSlop={8} accessibilityLabel="Player settings">
              <Icon name="more" size={20} color="#fff" />
            </PressableScale>
          </View>

          {/* Quick Audio Language Selector */}
          {!__DEV__ ? null : resolvingHls || !mountedStream || languageChoices.length === 0 ? (
            <View style={styles.quickAudioSection}>
              <View style={styles.quickAudioHeader}>
                <Icon name="mic" size={13} color={colors.accent} />
                <Text style={styles.quickAudioLabel}>AUDIO LANGUAGE  ·  DEV</Text>
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
                <Text style={styles.quickAudioLabel}>AUDIO LANGUAGE  ·  DEV</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickAudioList}
              >
                {languageChoices.map((choice) => {
                  const lower = choice.label.toLowerCase();
                  const flag =
                    lower.includes('hindi') ? '🇮🇳 ' :
                    lower.includes('japan') ? '🇯🇵 ' :
                    lower.includes('english') ? '🇬🇧 ' :
                    lower.includes('telugu') ? '🇮🇳 ' :
                    lower.includes('tamil') ? '🇮🇳 ' : '';

                  return (
                    <PressableScale
                      key={choice.key}
                      disabled={choice.disabled}
                      onPress={choice.onSelect}
                      style={[styles.quickAudioChip, choice.selected && styles.quickAudioChipActive]}
                    >
                      <Text style={[styles.quickAudioChipText, choice.selected && styles.quickAudioChipTextActive]}>
                        {flag}{choice.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Episode Synopsis */}
          {currentEpisodeObj?.overview || anime?.synopsis ? (
            <Text style={styles.synopsisText}>{currentEpisodeObj?.overview || anime?.synopsis}</Text>
          ) : null}

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

              <EpisodeCard
                number={nextEpisodeObj.episode_number}
                name={upNext.name}
                thumb={upNextPicture}
                runtime={anime?.duration ? parseInt(anime.duration, 10) || null : null}
                airingAt={upNext.airingAt ?? nextEpisodeObj.airingAt}
                upcoming={nextEpLocked}
                thumbW={upNextThumbW}
                onPress={handleNextEpisode}
              />
            </View>
          )}

          {/* All Episodes Redirect Link */}
          <PressableScale
            onPress={() => {
              // Leaves this screen rather than opening the page on top of it: on top, the video
              // kept playing underneath. Back to that page if it's open, or in place of this one.
              isPlayingRef.current = false;
              setIsPlaying(false);
              router.dismissTo(('/anime/' + (anime?.id || id)) as any);
            }}
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
      insets.bottom, anime, titleLang, currentEp, currentEpisodeObj, openSettings, resolvingHls, mountedStream, languageChoices,
      nextEpisodeObj, epData, currentSeason, handleNextEpisode, nextEpLocked, upNextPicture, id, thisEpisode.name, upNext.name, upNext.airingAt, upNextThumbW,
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
      >
        <BlurBehindMenu open={menuOpen}>
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
              fallbackAudioLanguage={secondAudioLang}
              preload={nextPreload}
              startTime={startTime}
              enhanced={enhanced}
              zoomStyle={videoZoomStyle}
              onSystemPause={onSystemPause}
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
                const playedTo = currentTimeRef.current;
                const length = durationRef.current;
                // A player can report "ended" while it's still settling (just after a jump to
                // a saved position, say). Believed, that marks the episode finished and starts
                // the next one. Anywhere but the real end, it carries on from where it is.
                if (!isRealEnd(playedTo, length)) {
                  if (__DEV__) console.log(`[Player] ignored an end signal at ${Math.floor(playedTo)} of ${Math.floor(length)} s`);
                  nativeVideoRef.current?.seek?.(playedTo);
                  return;
                }
                if (__DEV__) console.log(`[Player] episode ended at ${Math.floor(playedTo)} of ${Math.floor(length)} s`);
                if (anime && currentEp > 0) {
                  lastProgressCompletedRef.current = true;
                  const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
                  setProgress(anime, currentEp, total, { season: currentSeason, completed: true });
                }
                if (autoplay) handleNextEpisode();
              }}
              onError={onNativePlayerError}
            />
          ) : null}
        </BlurBehindMenu>

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
                quietRetriedRef.current = {};
                setHlsError(null);
                if (detailQ.isError) detailQ.refetch();
                setRetryNonce((n) => n + 1);
              }}
            >
              <Text style={styles.switchServerText}>Try again</Text>
            </PressableScale>
          </View>
        )}

        {__DEV__ && devNote ? (
          <View style={styles.devNote} pointerEvents="none">
            <Text style={styles.devNoteText}>
              <Text style={styles.devNoteTag}>DEV  </Text>
              {devNote}
            </Text>
          </View>
        ) : null}

        {/* Controls and gestures (tap, double-tap, brightness / volume drag, seek bar). */}
        {/* Stays mounted while settings are open: it holds the brightness set by
            dragging (unmounting it gave the screen back the phone's brightness). */}
        <PlayerOverlay
          visible={(controlsVisible && !settingsOpen) || !!shownError || currentEpLocked}
          locked={settingsOpen}
          failed={!!shownError || currentEpLocked}
          shape={screenShape}
          menuOpen={menuOpen}
          title={displayTitle(anime, titleLang) || anime?.title || 'AnimeVerse'}
          subtitle={`E${currentEp} · ${thisEpisode.name}`}
          isPlaying={isPlaying}
          isBuffering={isBuffering || resolvingHls || isStarting}
          time={playbackTime}
          duration={duration}
          buffered={playbackBuffered}
          volume={volume}
          insets={insets}
          chips={quickChips}
          menus={settingsSections}
          hasNext={!!nextEpisodeObj && !nextEpLocked}
          enhanced={enhanced}
          onToggleEnhance={toggleEnhance}
          autoplay={autoplay}
          onToggleAutoplay={toggleAutoplay}
          fitMode={fitMode}
          zoom={videoZoom}
          onZoomEnd={saveZoom}
          onControlsShown={resetHideTimer}
          onControlsHidden={onControlsHidden}
          onHoldControls={holdControls}
          onKeepAlive={resetHideTimer}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onSeekBy={handleSeekBy}
          onVolume={setVolume}
          onBack={() => (screenShape.get() ? exitFullscreen() : router.canGoBack() ? router.back() : router.replace('/'))}
          onToggleFullscreen={toggleFullscreen}
          onCycleFit={cycleFitMode}
          onOpenSettings={openAllSettings}
          onNext={handleNextEpisode}
        />

      </View>

      {/* Under-Player Content Area (Crunchyroll Layout in Portrait). Always
          mounted: in fullscreen it simply has no room (rebuilding it on every
          exit from fullscreen was another source of the delay). */}
        <BlurBehindMenu open={menuOpen} style={styles.detailsBlur}>
          {detailsReady ? detailsPanel : <View style={styles.detailsScroll} />}
        </BlurBehindMenu>

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
  devNote: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    maxWidth: '90%',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1,
    borderColor: '#FACC15',
    zIndex: 40,
  },
  devNoteText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
  devNoteTag: { color: '#FACC15', fontFamily: fonts.black, fontSize: 11 },
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


  // Crunchyroll Opening Content Advisory Badge

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
  detailsBlur: { flex: 1 },
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
  moreBtn: { marginLeft: 'auto', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
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
  synopsisText: {
    color: '#d0d0d0',
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 20,
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