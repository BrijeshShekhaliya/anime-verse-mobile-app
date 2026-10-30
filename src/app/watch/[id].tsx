import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import NativeHlsPlayer, { type NativePlayerTrack, type NativeVideoLevel } from '@/components/player/NativeHlsPlayer';
import { isAudioLanguageMatch, hasAudioLanguage } from '@/components/player/ExpoVideoHlsPlayer';
import { isStreamUrlExpired } from '@/services/animerulzClient';
import { EpisodeBadges } from '@/components/Badges';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { api, toFullUrl } from '@/lib/api';
import { useLibrary } from '@/lib/library';
import { useSettings, displayTitle } from '@/lib/settings';
import { colors, fonts, radius } from '@/lib/theme';
import type { Episode, EpisodesData, StreamData } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';

const MobileWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: any }>;

const SERVER_STORAGE_KEY = 'animeverse:preferred_server';
const AUTOPLAY_STORAGE_KEY = 'animeverse:autoplay';
type ServerType = 'vidrift' | 'hianime';
type FitMode = 'contain' | 'cover' | 'fill';
type SettingsSubView = 'main' | 'audio' | 'subtitles' | 'quality' | 'speed';

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

export default function WatchScreen() {
  const { id, season: paramSeason, ep: paramEp } = useLocalSearchParams<{ id: string; season?: string; ep?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // Authoritative fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Live container layout measurements (avoids pre-rotation Dimensions stale reads)
  const [layoutDimensions, setLayoutDimensions] = useState<{ width: number; height: number }>({
    width: width,
    height: height,
  });

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) {
      setLayoutDimensions({ width: Math.round(w), height: Math.round(h) });
    }
  }, []);

  const activeWidth = layoutDimensions.width || width;
  const activeHeight = layoutDimensions.height || height;
  const isPhysicalLandscape = activeWidth > activeHeight;
  // Do not expand the player to the full portrait viewport while the OS is
  // still rotating. Fullscreen presentation follows measured landscape layout.
  const isFullscreenView = isPhysicalLandscape;

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
  const [server, setServer] = useState<ServerType>('hianime');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [fitMode, setFitMode] = useState<FitMode>('contain'); // Default: contain (100% video visible, no crop)
  const [badgeText, setBadgeText] = useState<string | null>(null);

  // Dynamic Audio Tracks & Quality from Hls.js stream
  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState<number>(0);
  const [hasInBandAlternateAudio, setHasInBandAlternateAudio] = useState<boolean>(false);
  const [currentLang, setCurrentLang] = useState<'sub' | 'dub'>('sub');
  const [playerPreferencesLoaded, setPlayerPreferencesLoaded] = useState<boolean>(false);
  const [isSwitchingAudio, setIsSwitchingAudio] = useState<boolean>(false);

  const [availableLevels, setAvailableLevels] = useState<VideoLevelInfo[]>([]);
  const [availableTextTracks, setAvailableTextTracks] = useState<TextTrackInfo[]>([]);
  const [selectedQualityHeight, setSelectedQualityHeight] = useState<number>(defaultQualityHeight); // Default from user settings

  const [hlsStream, setHlsStream] = useState<StreamData | null>(null);
  const [mountedStream, setMountedStream] = useState<StreamData | null>(null);
  const [resolvingHls, setResolvingHls] = useState<boolean>(false);
  const [hlsError, setHlsError] = useState<string | null>(null);

  // Playback states
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [scrubbingTime, setScrubbingTime] = useState<number | null>(null);
  const [bufferedTime, setBufferedTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(1429); // fallback ~23:49
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [showAdvisory, setShowAdvisory] = useState<boolean>(true);

  // Settings
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsSubView, setSettingsSubView] = useState<SettingsSubView>('main');

  // Likes / Interactions
  const [liked, setLiked] = useState<boolean>(false);
  const [disliked, setDisliked] = useState<boolean>(false);
  const [likeCount, setLikeCount] = useState<number>(2940);
  const [dislikeCount, setDislikeCount] = useState<number>(18);

  const webViewRef = useRef<any>(null);
  const nativeVideoRef = useRef<any>(null);
  const nativePlayerTimeRef = useRef(0);
  const nativeSeekTargetRef = useRef<number | null>(null);
  const nativeSourceKeyRef = useRef<string | null>(null);
  const [nativeAudioTrackId, setNativeAudioTrackId] = useState<number | null>(null);
  const [nativeTextTrackId, setNativeTextTrackId] = useState<number | null>(null);
  const [resumeAfterSourceChange, setResumeAfterSourceChange] = useState<{ key: string; time: number; shouldPlay: boolean } | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advisoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const initialPinchDistRef = useRef<number | null>(null);
  const { setProgress } = useLibrary();
  const recordedEpRef = useRef<string | null>(null);
  const progressBarWidthRef = useRef<number>(width);

  const mountedStreamEpisodeKeyRef = useRef<string | null>(null);
  const inFlightEpisodeKeyRef = useRef<string | null>(null);
  const lastServerRef = useRef<ServerType>(server);
  const audioSwitchRequestRef = useRef(0);

  // Live state refs to capture values synchronously during stream switches
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(1429);
  const lastProgressCompletedRef = useRef<boolean>(false);
  const lastProgressSavedTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(true);
  const playbackSpeedRef = useRef<number>(1.0);
  const subtitlesEnabledRef = useRef<boolean>(true);
  const selectedQualityRef = useRef<number>(-1);
  const currentLangRef = useRef<'sub' | 'dub'>('sub');
  const preferredAudioNameRef = useRef<string | null>(null);
  const lastLoggedResolutionRef = useRef<string>('');
  const streamCacheRef = useRef<Map<string, { data: StreamData; expiresAt: number }>>(new Map());
  const inflightResolutionsRef = useRef<Map<string, Promise<StreamData>>>(new Map());
  const playerRetryCountRef = useRef<Record<string, number>>({});
  const prefetchedNextEpRef = useRef<string | null>(null);

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

    // 3. Server and Autoplay from device storage
    Promise.all([
      AsyncStorage.getItem(SERVER_STORAGE_KEY).catch(() => null),
      AsyncStorage.getItem(AUTOPLAY_STORAGE_KEY).catch(() => null),
    ]).then(([savedServer, savedAutoplay]) => {
      if (!active) return;
      if (savedServer === 'hianime' || savedServer === 'vidrift') {
        setServer(savedServer as ServerType);
      }
      if (savedAutoplay !== null) setAutoplay(savedAutoplay === '1');
      setPlayerPreferencesLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [audioLang, defaultQualityHeight]);

  // Unlock orientation sensor on unmount
  useEffect(() => {
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  // Stale callback protection across episode/stream switches
  const currentEpisodeKeyRef = useRef<string>(`${currentSeason}:${currentEp}`);
  useEffect(() => {
    currentEpisodeKeyRef.current = `${currentSeason}:${currentEp}`;
  }, [currentSeason, currentEp]);

  // Integrated Orientation Control (immediate non-blocking request)
  const enterLandscape = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  const restoreOrientation = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      .then(() => {
        // Prevent racing: wait for portrait orientation to settle before releasing sensor lock
        setTimeout(() => {
          ScreenOrientation.unlockAsync().catch(() => {});
        }, 350);
      })
      .catch(() => {
        ScreenOrientation.unlockAsync().catch(() => {});
      });
  }, []);

  const enterFullscreen = useCallback(() => {
    // Request rotation; the visual layout waits for measured landscape geometry.
    enterLandscape();
  }, [enterLandscape]);

  const exitFullscreen = useCallback(() => {
    // The view and status bar return to portrait when the measured bounds do.
    restoreOrientation();
  }, [restoreOrientation]);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreenView) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreenView, enterFullscreen, exitFullscreen]);

  // Listen to physical device orientation changes
  useEffect(() => {
    const sub = ScreenOrientation.addOrientationChangeListener((evt) => {
      const orientation = evt.orientationInfo.orientation;
      const isLand =
        orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      if (isLand && !isFullscreen) {
        setIsFullscreen(true);
      } else if (!isLand && isFullscreen) {
        setIsFullscreen(false);
      }
    });
    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
    };
  }, [isFullscreen]);

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
      try {
        nativeVideoRef.current?.pause?.();
      } catch {}
      return false; // In portrait, let default router back handle it
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isFullscreenView, settingsOpen, exitFullscreen]);

  // Clean status bar handling for Android
  useEffect(() => {
    RNStatusBar.setHidden(isFullscreenView, 'none');
  }, [isFullscreenView]);

  // Restore screen orientation and stop player on unmount
  useEffect(() => {
    return () => {
      RNStatusBar.setHidden(false, 'none');
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        .catch(() => {})
        .then(() => ScreenOrientation.unlockAsync().catch(() => {}));
      try {
        nativeVideoRef.current?.pause?.();
      } catch {}
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

  // Update video fit mode in CSS WITHOUT reloading HTML/WebView!
  const changeFitMode = useCallback(
    (newMode: FitMode) => {
      setFitMode(newMode);
      webViewRef.current?.injectJavaScript(`
        (function() {
          var v = document.getElementById('player');
          if (v) { v.className = '${newMode}'; }
        })();
        true;
      `);
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
  const { data: anime } = useFetch(() => api.detail(String(id)), [id], initialAnime);

  // Synchronous AniList ID resolution (0ms startup without waiting for network GraphQL)
  const initialAnilistId = useMemo(() => {
    if (typeof id === 'number' && id > 0) return id;
    if (typeof id === 'string') {
      if (id.startsWith('al')) {
        const p = parseInt(id.slice(2), 10);
        if (!isNaN(p) && p > 0) return p;
      } else if (/^\d+$/.test(id)) {
        const p = parseInt(id, 10);
        if (!isNaN(p) && p > 0) return p;
      }
    }
    return initialAnime?.anilistId || undefined;
  }, [id, initialAnime?.anilistId]);

  // Fetch episodes for current season with instant synchronous cache
  const initialEps = useMemo(() => api.getCachedEpisodes(String(id), currentSeason), [id, currentSeason]);
  const { data: epData, loading: episodesLoading } = useFetch(
    () => api.episodes(String(id), currentSeason),
    [id, currentSeason],
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
          if (res && res.streamUrl) {
            streamCacheRef.current.set(key, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
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
    if (!playerPreferencesLoaded || server !== 'hianime' || (!anime?.title && !initialAnime?.title && !initialAnilistId)) return;

    if (lastServerRef.current !== server) {
      lastServerRef.current = server;
      mountedStreamEpisodeKeyRef.current = null;
    }

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
    // If the stream for this exact season & episode is already actively mounted and has a valid URL,
    // do not destroy playback or restart the stream just because background epData or metadata re-rendered!
    if (mountedStreamEpisodeKeyRef.current === episodeKey && mountedStream?.streamUrl) {
      return;
    }
    // If resolution for this episode is already actively in-flight, avoid duplicate concurrent network calls.
    if (inFlightEpisodeKeyRef.current === episodeKey) {
      return;
    }

    let cancelled = false;
    currentEpisodeKeyRef.current = episodeKey;
    inFlightEpisodeKeyRef.current = episodeKey;

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
    )
      .then((res) => {
        if (cancelled || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
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

          // If user preferred Hindi, but stream only has Japanese (Sub) without Hindi:
          const isPrefHindi = preferredAudioNameRef.current?.includes('hindi');
          const hasHindi = res.audioTracks && hasAudioLanguage(res.audioTracks, 'hindi');
          if (isPrefHindi && !hasHindi && res.mode === 'sub') {
            showBadge('Hindi dub unavailable — Playing in Japanese');
          }
        } else {
          setHlsError('Stream currently unavailable. Tap to retry or switch server.');
        }
      })
      .catch((err) => {
        if (cancelled || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        setHlsError('Stream currently unavailable. Tap to retry or switch server.');
      })
      .finally(() => {
        if (inFlightEpisodeKeyRef.current === episodeKey) {
          inFlightEpisodeKeyRef.current = null;
        }
        if (!cancelled && currentEpisodeKeyRef.current === episodeKey) {
          setResolvingHls(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [playerPreferencesLoaded, server, anime?.title, anime?.titleRomaji, anime?.languages?.dub, epData, currentSeason, currentEp, currentEpHasDub, resolveStreamWithCache]);

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

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    } else {
      resetHideTimer();
    }
  }, [controlsVisible, resetHideTimer]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [resetHideTimer]);

  // JavaScript injection is only used for the VidRift iframe fallback.
  const sendPlayerCommand = useCallback((code: string) => {
    if (server === 'vidrift') webViewRef.current?.injectJavaScript(`(function(){ ${code} })(); true;`);
  }, [server]);
  const seekNativePlayer = useCallback((time: number) => {
    const target = Math.max(0, time);
    nativeSeekTargetRef.current = target;
    nativeVideoRef.current?.seek?.(target);
    nativePlayerTimeRef.current = target;
    currentTimeRef.current = target;
  }, []);

  // Controls Actions
  const handleTogglePlay = useCallback(() => {
    if (server === 'vidrift') {
      sendPlayerCommand("var v=document.querySelector('video');if(v){if(v.paused)v.play();else v.pause();}");
    }
    setIsPlaying((prev) => { isPlayingRef.current = !prev; return !prev; });
    resetHideTimer();
  }, [server, sendPlayerCommand, resetHideTimer]);

  const handleRewind10 = useCallback(() => {
    const next = Math.max(0, nativePlayerTimeRef.current - 10);
    if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.currentTime=${next};`); else seekNativePlayer(next);
    setCurrentTime(next); resetHideTimer();
  }, [server, sendPlayerCommand, seekNativePlayer, resetHideTimer]);

  const handleForward10 = useCallback(() => {
    const next = Math.min(duration || Number.MAX_SAFE_INTEGER, nativePlayerTimeRef.current + 10);
    if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.currentTime=${next};`); else seekNativePlayer(next);
    setCurrentTime(next); resetHideTimer();
  }, [duration, server, sendPlayerCommand, seekNativePlayer, resetHideTimer]);

  const handleSeek = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(duration, targetSec));
      setCurrentTime(clamped);
      if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.currentTime=${clamped};`); else seekNativePlayer(clamped);
      resetHideTimer();
    },
    [duration, server, sendPlayerCommand, seekNativePlayer, resetHideTimer],
  );

  const handleSetSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed); playbackSpeedRef.current = speed;
    if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.playbackRate=${speed};`);
  }, [server, sendPlayerCommand]);

  // The separate-stream in-place switch is retained only for VidRift. HiAnime
  // source changes are delegated to the native Video source prop.
  const applyStreamInPlace = useCallback((stream: StreamData, episodeKey: string, resumeTime = 0, shouldPlay = true, speed = playbackSpeedRef.current, quality = selectedQualityRef.current) => {
    if (server !== 'vidrift' || !stream?.streamUrl) return false;
    const subtitles = JSON.stringify((stream.subtitles || []).map((sub, idx) => ({label:sub.label || sub.lang || 'English',lang:sub.lang || 'en',src:toFullUrl(sub.src),default:sub.default || idx === 0})));
    sendPlayerCommand(`if(window.switchStream)window.switchStream(${JSON.stringify(toFullUrl(stream.streamUrl))},${subtitles},${resumeTime},${shouldPlay},${speed},${quality},${JSON.stringify(episodeKey)});`);
    return true;
  }, [server, sendPlayerCommand]);

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
        if (server === 'vidrift') sendPlayerCommand(`if(window._hls)window._hls.audioTrack=${selection.trackId};`);
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
        const resolved = await resolveStreamWithCache(
          anime!.title,
          anime!.titleRomaji || undefined,
          currentSeason,
          currentEp,
          targetMode,
        );

        // Guard against episode changes and newer audio selections.
        if (requestId !== audioSwitchRequestRef.current || currentEpisodeKeyRef.current !== requestedEpisodeKey) return;

        if (!resolved || !resolved.streamUrl) {
          throw new Error(`Could not load ${targetMode.toUpperCase()} stream`);
        }

        const capturedTime = nativePlayerTimeRef.current || currentTimeRef.current;
        if (server === 'vidrift') {
          const dispatched = applyStreamInPlace(resolved, requestedEpisodeKey, capturedTime, isPlayingRef.current, playbackSpeedRef.current, selectedQualityRef.current);
          if (!dispatched) throw new Error('Player is still preparing. Please try again.');
        } else {
          const switchKey = `${requestedEpisodeKey}:${targetMode}:${resolved.streamUrl}`;
          setResumeAfterSourceChange({ key: switchKey, time: capturedTime, shouldPlay: isPlayingRef.current });
          mountedStreamEpisodeKeyRef.current = requestedEpisodeKey;
          // Keep the existing player surface and custom controls mounted while
          // ExoPlayer replaces the source. The resolver spinner is only for the
          // initial URL lookup; actual media loading is shown by isBuffering.
          setResolvingHls(false);
          setIsBuffering(true);
          setMountedStream(resolved);
        }

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
      currentSeason,
      currentEp,
      resolveStreamWithCache,
      sendPlayerCommand,
      showBadge,
      applyStreamInPlace,
    ],
  );

  const handleSelectQuality = useCallback((targetHeight: number) => {
    setSelectedQualityHeight(targetHeight);
    selectedQualityRef.current = targetHeight;
    sessionQualityOverrideRef.current = targetHeight;
    console.log(`[Player Quality] User switched quality to: ${targetHeight === -1 ? 'Auto' : `${targetHeight}p`}`);
    if (server === 'vidrift') sendPlayerCommand(`if(window._hls)window._hls.currentLevel=${targetHeight};`);
    // Native HLS uses resolution-based track selection; the native engine chooses
    // the closest available resolution when exact variants differ.
    showBadge(targetHeight === -1 ? 'Quality: Auto' : `Quality: ${targetHeight}p`);
  }, [server, sendPlayerCommand, showBadge]);

  const handleToggleSubtitles = useCallback(
    (enable: boolean) => {
      setSubtitlesEnabled(enable);
      subtitlesEnabledRef.current = enable;
      if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v&&v.textTracks)for(var i=0;i<v.textTracks.length;i++)v.textTracks[i].mode='${enable ? 'showing' : 'hidden'}';`);
      showBadge(enable ? 'Subtitles On' : 'Subtitles Off');
    },
    [server, sendPlayerCommand, showBadge],
  );

  const handleNextEpisode = useCallback(() => {
    if (episodes.length === 0) return;
    const maxEp = episodes[episodes.length - 1].episode_number;
    if (currentEp < maxEp) {
      if (anime) {
        lastProgressCompletedRef.current = true;
        const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
        setProgress(anime, currentEp, total, { completed: true });
      }
      const nextEp = currentEp + 1;
      currentEpisodeKeyRef.current = `${currentSeason}:${nextEp}`;
      audioSwitchRequestRef.current += 1;
      setIsSwitchingAudio(false);
      setResumeAfterSourceChange(null);
      nativePlayerTimeRef.current = 0;
      currentTimeRef.current = 0;
      isPlayingRef.current = true;
      setHlsError(null);
      setResolvingHls(true);
      setIsBuffering(true);
      setCurrentEp(nextEp);
      setCurrentTime(0);
      setBufferedTime(0);
      setIsPlaying(true);
      resetHideTimer();
    }
  }, [currentEp, currentSeason, episodes, resetHideTimer]);

  // Scrubber layout measurement reference for 100% accurate pageX drag calculation
  const scrubberAreaRef = useRef<any>(null);
  const scrubberLayoutRef = useRef<{ pageX: number; width: number }>({ pageX: 0, width: 1 });

  // Instant Double-tap & Tap handler (YouTube / MX Player style with 0ms latency)
  const handlePlayerAreaPress = useCallback(
    (e: GestureResponderEvent) => {
      const now = Date.now();
      const touchX = e.nativeEvent.locationX;
      const barW = progressBarWidthRef.current || width;

      // When controls are already visible, ANY single tap anywhere hides controls IMMEDIATELY (0ms!)
      if (controlsVisible) {
        setControlsVisible(false);
        if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
        lastTapRef.current = { time: 0, x: 0 };
        return;
      }

      // When controls are hidden:
      // Center zone (28% to 72% width) reveals controls INSTANTLY (0ms!) without any double-tap delay
      const isLeftWing = touchX < barW * 0.28;
      const isRightWing = touchX > barW * 0.72;

      if (!isLeftWing && !isRightWing) {
        resetHideTimer();
        lastTapRef.current = { time: 0, x: 0 };
        return;
      }

      // On left/right wings: check for double tap
      if (now - lastTapRef.current.time < 300) {
        if (isLeftWing) {
          handleRewind10();
          showBadge('-10s');
        } else if (isRightWing) {
          handleForward10();
          showBadge('+10s');
        }
        lastTapRef.current = { time: 0, x: 0 };
      } else {
        lastTapRef.current = { time: now, x: touchX };
        setTimeout(() => {
          if (lastTapRef.current.time === now) {
            resetHideTimer();
          }
        }, 220);
      }
    },
    [controlsVisible, width, handleRewind10, handleForward10, resetHideTimer, showBadge],
  );

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

  // Rock-solid 60 FPS Scrubber with pageX absolute geometry and time preview bubble
  const updateScrubberFromPageX = useCallback(
    (pageX: number, commit = false) => {
      const { pageX: startX, width: barW } = scrubberLayoutRef.current;
      const effectiveW = Math.max(1, barW);
      const relativeX = pageX - startX;
      const ratio = Math.max(0, Math.min(1, relativeX / effectiveW));
      const targetTime = ratio * duration;
      if (commit) {
        setScrubbingTime(null);
        handleSeek(targetTime);
      } else {
        setScrubbingTime(targetTime);
        resetHideTimer();
      }
    },
    [duration, handleSeek, resetHideTimer],
  );

  const handleScrubberGrant = useCallback(
    (e: GestureResponderEvent) => {
      updateScrubberFromPageX(e.nativeEvent.pageX, false);
    },
    [updateScrubberFromPageX],
  );

  const handleScrubberMove = useCallback(
    (e: GestureResponderEvent) => {
      updateScrubberFromPageX(e.nativeEvent.pageX, false);
    },
    [updateScrubberFromPageX],
  );

  const handleScrubberRelease = useCallback(
    (e: GestureResponderEvent) => {
      updateScrubberFromPageX(e.nativeEvent.pageX, true);
    },
    [updateScrubberFromPageX],
  );

  const handleScrubberTerminate = useCallback(() => {
    setScrubbingTime(null);
  }, []);

  // Build VidRift embed URL (fallback server)
  const vidriftEmbedUrl = useMemo(() => {
    const tmdbId = epData?.tmdbId;
    const params = new URLSearchParams({
      brand: 'AnimeVerse',
      brandColor: 'ff640a',
      brandLogo: 'https://api.iconify.design/ri/moon-clear-fill.svg?color=%23ff640a',
      watermark: '1',
      font: 'Inter',
      controlBg: 'solid',
      hide: 'episodes,next,server,cast',
      fs: 'parent',
    });

    return tmdbId
      ? `https://embed.vidrift.net/embed/tv/${tmdbId}/${currentSeason}/${currentEp}?${params.toString()}`
      : `https://embed.vidrift.net/embed/anilist/${id}/${currentEp}?${params.toString()}`;
  }, [epData?.tmdbId, currentSeason, currentEp, id]);

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
    if (server !== 'hianime' || !mountedStream?.streamUrl || !nativeStreamKey) return;
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
        if (match) {
          initialAudioId = match.id;
        }
      }
    } else {
      setAvailableAudioTracks([]);
      setHasInBandAlternateAudio(false);
    }

    // Immediately activate the preferred audio track (e.g. Hindi) on frame 1 without resetting to Japanese!
    setCurrentAudioTrackId(initialAudioId);
    setNativeAudioTrackId(initialAudioId);

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
    server,
    mountedStream?.streamUrl,
    mountedStream?.audioTracks,
    mountedStream?.videoLevels,
    mountedStream?.subtitles,
    nativeStreamKey,
  ]);

  const onNativePlayerLoad = useCallback((loadedDuration: number) => {
    if (loadedDuration > 0) setDuration(loadedDuration);
    const pending = resumeAfterSourceChange;
    if (pending && pending.key === nativeSourceKeyRef.current) {
      if (pending.time > 0) {
        nativeVideoRef.current?.seek?.(pending.time);
        nativePlayerTimeRef.current = pending.time;
        currentTimeRef.current = pending.time;
        setCurrentTime(pending.time);
      }
      setIsPlaying(pending.shouldPlay);
      isPlayingRef.current = pending.shouldPlay;
      setResumeAfterSourceChange(null);
    }
    setIsBuffering(false);
    setResolvingHls(false);
  }, [resumeAfterSourceChange]);

  const onNativePlayerProgress = useCallback(
    (time: number, loadedDuration: number, playable: number, videoWidth?: number, videoHeight?: number) => {
      nativePlayerTimeRef.current = time;
      currentTimeRef.current = time;
      setCurrentTime(time);
      const seekTarget = nativeSeekTargetRef.current;
      if (seekTarget !== null && Math.abs(time - seekTarget) <= 1.5) {
        nativeSeekTargetRef.current = null;
        setIsBuffering(false);
      }
      if (loadedDuration > 0) setDuration(loadedDuration);
      setBufferedTime(playable);

      if (videoHeight && videoHeight > 0) {
        const resKey = `${videoWidth || 0}x${videoHeight}`;
        if (resKey !== lastLoggedResolutionRef.current) {
          lastLoggedResolutionRef.current = resKey;
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

        // Crunchyroll-Style Background Preload: pre-resolve next episode stream when current episode is >= 70% or > 3 mins
        const nextEp = currentEp + 1;
        const total = epData?.episodes?.length || anime?.episodes || anime?.episodeCount || 0;
        const nextKey = `${currentSeason}:${nextEp}`;
        if ((ratio >= 0.7 || time >= 180) && nextEp <= total && prefetchedNextEpRef.current !== nextKey) {
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
    [currentEp, currentSeason, epData, anime, resolveStreamWithCache],
  );

  const onNativePlayerAudioTracks = useCallback((tracks: NativePlayerTrack[]) => {
    const audio = tracks.filter((track) => track.type === 'audio');
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
        setNativeAudioTrackId(initial.id);
        setCurrentAudioTrackId(initial.id);
        if (pref && !match && (pref.includes('hindi') || pref === 'hin' || pref === 'hi')) {
          showBadge(`Audio: ${initial.name} (Hindi not available for this anime)`);
        }
      }
    }
  }, [showBadge]);

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
    console.log(
      `[Native Media3 Tracks] Video quality levels available (${levels.length}):`,
      levels.map((l) => `${l.height}p`).join(', '),
    );
    setAvailableLevels(levels);
    const targetHeight = selectedQualityRef.current;
    if (targetHeight > 0 && levels.length > 0) {
      const match = levels.find((level) => level.height === targetHeight);
      if (match) {
        setSelectedQualityHeight(targetHeight);
        selectedQualityRef.current = targetHeight;
      } else {
        // Fallback: If preferred resolution (e.g. 1080p) is not available,
        // pick the highest resolution available within target (e.g. 720p or 480p)
        const bestAvailable = levels.find((l) => l.height <= targetHeight) || levels[0];
        if (bestAvailable) {
          setSelectedQualityHeight(bestAvailable.height);
          selectedQualityRef.current = bestAvailable.height;
          showBadge(`Quality: ${bestAvailable.height}p (Max available)`);
        }
      }
    }
  }, [showBadge]);

  const onNativePlayerError = useCallback((message: string) => {
    const epKey = `${currentSeason}:${currentEp}`;
    const retries = playerRetryCountRef.current[epKey] || 0;

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
      mountedStreamEpisodeKeyRef.current = null;
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
            setHlsStream(res);
            setMountedStream(res);
            setHlsError(null);
          } else {
            setHlsError('Stream currently unavailable. Tap to retry or switch server.');
          }
        })
        .catch(() => {
          setHlsError('Stream currently unavailable. Tap to retry or switch server.');
        })
        .finally(() => {
          setResolvingHls(false);
        });
      return;
    }

    setIsBuffering(false);
    setHlsError(message || 'Unable to play this stream');
    setResolvingHls(false);
  }, [currentSeason, currentEp, id, anime, epData, resolveStreamWithCache]);

  const handleVidRiftMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'play') {
        setIsPlaying(true);
        isPlayingRef.current = true;
      } else if (data.type === 'pause') {
        setIsPlaying(false);
        isPlayingRef.current = false;
      } else if (data.type === 'timeupdate') {
        if (typeof data.currentTime === 'number') {
          currentTimeRef.current = data.currentTime;
          nativePlayerTimeRef.current = data.currentTime;
          setCurrentTime(data.currentTime);
        }
        if (typeof data.duration === 'number' && data.duration > 0) setDuration(data.duration);
      } else if (data.type === 'buffered' && typeof data.buffered === 'number') {
        setBufferedTime(data.buffered);
      } else if (data.type === 'vidrift:ended' || data.type === 'vidrift:nextup-play' || data.type === 'ended') {
        if (autoplay) handleNextEpisode();
      }
    } catch {}
  }, [autoplay, handleNextEpisode]);

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

  const displayTime = scrubbingTime !== null ? scrubbingTime : currentTime;
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, displayTime / duration)) : 0;
  const bufferedRatio = duration > 0 ? Math.min(1, Math.max(0, bufferedTime / duration)) : 0;

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

  return (
    <View
      style={[styles.container, isFullscreenView ? styles.containerFullscreen : { paddingTop: insets.top }]}
      onLayout={onRootLayout}
    >
      <StatusBar hidden={isFullscreenView} style="light" />

      {/* Video Player Container (Integer math prevents Android YUV chroma green line decoder glitch) */}
      <View
        style={[
          styles.playerContainer,
          isFullscreenView
            ? styles.playerContainerLandscape
            : [styles.playerContainerPortrait, { height: Math.floor((activeWidth * 9) / 16) }],
        ]}
        onLayout={(e) => {
          progressBarWidthRef.current = e.nativeEvent.layout.width;
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {server === 'hianime' ? (
          mountedStream?.streamUrl ? (
            <NativeHlsPlayer
              ref={nativeVideoRef}
              uri={mountedStream.rawMasterUrl || toFullUrl(mountedStream.streamUrl)}
              referer={mountedStream.referer}
              paused={!isPlaying || resolvingHls}
              playbackRate={playbackSpeed}
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
          ) : null
        ) : (
          <MobileWebView
            ref={webViewRef}
            source={{ uri: vidriftEmbedUrl }}
            style={styles.webView}
            containerStyle={{ backgroundColor: '#000000' }}
            javaScriptEnabled
            domStorageEnabled
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows
            originWhitelist={['*']}
            onMessage={handleVidRiftMessage}
            startInLoadingState={false}
            renderToHardwareTextureAndroid
            overScrollMode="never"
            scrollEnabled={false}
            scalesPageToFit={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Loading Overlay (Non-destructive to WebView) */}
        {server === 'hianime' && resolvingHls && (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.placeholderText}>Loading Stream...</Text>
          </View>
        )}

        {/* Error Overlay (Non-destructive to WebView) */}
        {server === 'hianime' && !resolvingHls && hlsError && (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]}>
            <Icon name="info" size={32} color={colors.accent} />
            <Text style={styles.placeholderError}>{hlsError}</Text>
            <PressableScale
              style={styles.switchServerBtn}
              onPress={() => {
                setServer('vidrift');
                AsyncStorage.setItem(SERVER_STORAGE_KEY, 'vidrift').catch(() => {});
              }}
            >
              <Text style={styles.switchServerText}>Play with VidRift</Text>
            </PressableScale>
          </View>
        )}

        {server === 'hianime' && isBuffering && isPlaying && !resolvingHls && !hlsError && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.accent} />
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

        {/* Touch Handler Surface (Single tap: toggle controls, Double tap: +/- 10s or play/pause) */}
        {!settingsOpen && <Pressable style={StyleSheet.absoluteFill} onPress={handlePlayerAreaPress} />}

        {/* 100% Integrated Crunchyroll Video Player UI */}
        {controlsVisible && !settingsOpen && (
          <View style={styles.controlsOverlay} pointerEvents="box-none">
            {/* Top Bar with subtle vignette gradient */}
            <LinearGradient
              colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.3)', 'transparent']}
              style={[
                styles.playerTopBar,
                isFullscreenView && {
                  paddingTop: Math.max(insets.top, 10),
                  paddingHorizontal: Math.max(insets.left, 16),
                },
              ]}
              pointerEvents="box-none"
            >
              {isFullscreenView ? (
                // Landscape Top-Left: Back Arrow to Exit Fullscreen + Series Title + Episode Title
                <View style={styles.landscapeTitleWrap}>
                  <PressableScale
                    onPress={exitFullscreen}
                    style={styles.landscapeBackBtn}
                    accessibilityLabel="Exit Fullscreen"
                  >
                    <Icon name="left" size={24} color="#fff" />
                  </PressableScale>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.landscapeSeriesTitle} numberOfLines={1}>
                      {displayTitle(anime, titleLang) || anime?.title || 'AnimeVerse'}
                    </Text>
                    <Text style={styles.landscapeEpTitle} numberOfLines={1}>
                      E{currentEp} – {currentEpisodeObj?.name || `Episode ${currentEp}`}
                    </Text>
                  </View>
                </View>
              ) : (
                // Portrait Top-Left: Back Arrow
                <PressableScale
                  onPress={() => {
                    try {
                      nativeVideoRef.current?.pause?.();
                    } catch {}
                    if (router.canGoBack()) router.back();
                    else router.replace('/');
                  }}
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Back"
                >
                  <Icon name="left" size={24} color="#fff" />
                </PressableScale>
              )}

              {/* Top-Right Control Icons: [Fit/Zoom Mode] [Next] [Cast] [Settings] [Fullscreen/Exit] */}
              <View style={styles.playerTopRightIcons}>
                {/* Dynamic Aspect Ratio / Fit Toggle */}
                <PressableScale
                  onPress={cycleFitMode}
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Toggle Screen Fit Mode"
                >
                  <Icon name="aspectRatio" size={22} color={fitMode !== 'contain' ? colors.accent : '#fff'} />
                </PressableScale>

                {nextEpisodeObj && (
                  <PressableScale
                    onPress={handleNextEpisode}
                    style={styles.iconCircleBtn}
                    accessibilityLabel="Next Episode"
                  >
                    <Icon name="skip" size={22} color="#fff" />
                  </PressableScale>
                )}
                <PressableScale
                  onPress={() =>
                    Alert.alert('Cast to Screen', 'Scanning local network for Google Cast & AirPlay devices...')
                  }
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Cast"
                >
                  <Icon name="cast" size={22} color="#fff" />
                </PressableScale>
                <PressableScale
                  onPress={() => {
                    setSettingsSubView('main');
                    setSettingsOpen(true);
                  }}
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Playback Settings"
                >
                  <Icon name="settings" size={22} color="#fff" />
                </PressableScale>
                <PressableScale
                  onPress={toggleFullscreen}
                  style={styles.iconCircleBtn}
                  accessibilityLabel={isFullscreenView ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  <Icon name={isFullscreenView ? 'exitFullscreen' : 'fullscreen'} size={22} color="#fff" />
                </PressableScale>
              </View>
            </LinearGradient>

            {/* Center Controls: [↺ 10]  [▶ / ⏸]  [↻ 10] (Crystal-clear background) */}
            <View style={styles.centerControlsRow} pointerEvents="box-none">
              <PressableScale
                onPress={handleRewind10}
                style={styles.centerIconBtn}
                accessibilityLabel="Rewind 10 seconds"
              >
                <Icon name="rewind10" size={isFullscreenView ? 44 : 38} color="#fff" />
              </PressableScale>

              <PressableScale
                onPress={handleTogglePlay}
                style={[styles.centerPlayBtn, isFullscreenView && styles.centerPlayBtnLandscape]}
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              >
                <Icon name={isPlaying ? 'pause' : 'play'} size={isFullscreenView ? 48 : 42} color="#fff" />
              </PressableScale>

              <PressableScale
                onPress={handleForward10}
                style={styles.centerIconBtn}
                accessibilityLabel="Forward 10 seconds"
              >
                <Icon name="forward10" size={isFullscreenView ? 44 : 38} color="#fff" />
              </PressableScale>
            </View>

            {/* Bottom Bar: Timecodes + Preload + Orange Scrubber Bar with subtle gradient */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)']}
              style={[
                styles.playerBottomBar,
                isFullscreenView && {
                  paddingHorizontal: Math.max(insets.left, 16),
                  paddingBottom: Math.max(insets.bottom, 10),
                },
              ]}
              pointerEvents="box-none"
            >
              <View style={styles.timecodeRow}>
                <Text style={styles.timecodeText}>{formatDuration(displayTime)}</Text>
                <Text style={styles.timecodeText}>{formatDuration(duration)}</Text>
              </View>

              {/* Scrubber Touch & Drag Area with Preload / Buffer Bar */}
              <View
                ref={scrubberAreaRef}
                style={styles.scrubberTouchArea}
                onLayout={(e: LayoutChangeEvent) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0) scrubberLayoutRef.current.width = w;
                  scrubberAreaRef.current?.measure((_x: number, _y: number, measuredWidth: number, _h: number, pageX: number) => {
                    if (measuredWidth > 0) {
                      scrubberLayoutRef.current = { pageX, width: measuredWidth };
                    }
                  });
                }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={handleScrubberGrant}
                onResponderMove={handleScrubberMove}
                onResponderRelease={handleScrubberRelease}
                onResponderTerminate={handleScrubberTerminate}
              >
                {/* Floating Preview Time Bubble when Scrubbing */}
                {scrubbingTime !== null && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.scrubBubble,
                      {
                        left: `${Math.max(0, Math.min(1, scrubbingTime / Math.max(1, duration))) * 100}%`,
                      },
                    ]}
                  >
                    <Text style={styles.scrubBubbleText}>{formatDuration(scrubbingTime)}</Text>
                  </View>
                )}

                <View style={styles.scrubberTrack} pointerEvents="none">
                  {/* Preloaded / Buffered Bar */}
                  <View style={[styles.scrubberBuffered, { width: `${bufferedRatio * 100}%` }]} pointerEvents="none" />
                  {/* Played Progress Bar */}
                  <View style={[styles.scrubberProgress, { width: `${progressRatio * 100}%` }]} pointerEvents="none" />
                </View>
                {/* Thumb Indicator */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.scrubberThumb,
                    scrubbingTime !== null && styles.scrubberThumbActive,
                    {
                      left: `${progressRatio * 100}%`,
                    },
                  ]}
                />
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Crunchyroll In-Place Playback Settings Screen Overlay (Matches Screenshots 3 & 4) */}
        {settingsOpen && (
          <View
            style={[
              styles.settingsScreenOverlay,
              isFullscreenView
                ? {
                    paddingTop: Math.max(insets.top, 10),
                    paddingHorizontal: Math.max(insets.left, 24),
                    paddingBottom: Math.max(insets.bottom, 12),
                  }
                : { paddingTop: 12, paddingHorizontal: 18 },
            ]}
          >
            {/* Main Settings Menu */}
            {settingsSubView === 'main' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsOpen(false)} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Playback Settings</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                  {/* Autoplay Row */}
                  <View style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Autoplay</Text>
                    <Switch
                      value={autoplay}
                      onValueChange={(val) => {
                        setAutoplay(val);
                        AsyncStorage.setItem(AUTOPLAY_STORAGE_KEY, val ? '1' : '0').catch(() => {});
                      }}
                      trackColor={{ false: '#333', true: '#26a69a' }}
                      thumbColor="#fff"
                    />
                  </View>

                  {/* Audio Row (Dynamic multi-track audio!) */}
                  <PressableScale onPress={() => setSettingsSubView('audio')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Audio</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>{currentAudioName}</Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Subtitles/CC Row */}
                  <PressableScale onPress={() => setSettingsSubView('subtitles')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Subtitles/CC</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>{currentSubtitleName}</Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Quality Row (Dynamic 1080p, 720p, 480p, Auto) */}
                  <PressableScale onPress={() => setSettingsSubView('quality')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Quality</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>
                        {selectedQualityHeight === -1 ? 'Auto' : `${selectedQualityHeight}p`}
                      </Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Screen Fit Mode */}
                  <PressableScale
                    onPress={() => {
                      cycleFitMode();
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={styles.settingsLabel}>Screen Scaling</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={[styles.settingsValueText, { color: colors.accent }]}>
                        {fitMode === 'contain' ? 'Fit to Screen' : fitMode === 'cover' ? 'Zoom to Fill' : 'Stretch'}
                      </Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Server Source */}
                  <PressableScale
                    onPress={() => {
                      const next = server === 'vidrift' ? 'hianime' : 'vidrift';
                      setServer(next);
                      AsyncStorage.setItem(SERVER_STORAGE_KEY, next).catch(() => {});
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={styles.settingsLabel}>Server Source</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={[styles.settingsValueText, { color: colors.accent }]}>
                        {server === 'vidrift' ? 'VidRift (Web)' : 'Native Player (Direct)'}
                      </Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Playback Speed Row */}
                  <PressableScale onPress={() => setSettingsSubView('speed')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Playback Speed</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>{playbackSpeed.toFixed(1)}x</Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Report a Problem */}
                  <PressableScale
                    onPress={() => {
                      Alert.alert('Report a Problem', 'Playback issue reported. Switch server to restore stream?', [
                        {
                          text: 'Switch to ' + (server === 'vidrift' ? 'Native Player' : 'VidRift'),
                          onPress: () => {
                            const next = server === 'vidrift' ? 'hianime' : 'vidrift';
                            setServer(next);
                            AsyncStorage.setItem(SERVER_STORAGE_KEY, next).catch(() => {});
                          },
                        },
                        { text: 'Cancel', style: 'cancel' },
                      ]);
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={styles.settingsLabel}>Report a Problem</Text>
                    <Icon name="right" size={16} color={colors.muted} />
                  </PressableScale>
                </ScrollView>
              </>
            )}

            {/* Audio Sub-View */}
            {settingsSubView === 'audio' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Audio Channels</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {hasInBandAlternateAudio ? (
                    // In-band alternate audio tracks
                    availableAudioTracks.map((track) => {
                      const isSel = currentAudioTrackId === track.id;
                      return (
                        <PressableScale
                          key={track.id}
                          onPress={() => {
                            handleSelectAudio({ type: 'in-band', trackId: track.id });
                            setSettingsSubView('main');
                          }}
                          style={styles.settingsRow}
                        >
                          <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>
                            {track.name || track.lang}
                          </Text>
                          {isSel && <Icon name="check" size={20} color={colors.accent} />}
                        </PressableScale>
                      );
                    })
                  ) : (
                    // Separate Sub / Dub stream options
                    <>
                      {/* Japanese (Sub) */}
                      <PressableScale
                        onPress={() => {
                          if (currentLang !== 'sub') {
                            handleSelectAudio({ type: 'separate', mode: 'sub' });
                          }
                          setSettingsSubView('main');
                        }}
                        style={styles.settingsRow}
                        disabled={isSwitchingAudio}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.settingsLabel, currentLang === 'sub' && { color: colors.accent }]}>
                            Japanese (Sub)
                          </Text>
                          <Text style={styles.settingsSubLabel}>Original Japanese audio with English subtitles</Text>
                        </View>
                        {currentLang === 'sub' && <Icon name="check" size={20} color={colors.accent} />}
                      </PressableScale>

                      {/* English (Dub) */}
                      <PressableScale
                        onPress={() => {
                          if (!currentEpHasDub) return;
                          if (currentLang !== 'dub') {
                            handleSelectAudio({ type: 'separate', mode: 'dub' });
                          }
                          setSettingsSubView('main');
                        }}
                        style={[styles.settingsRow, !currentEpHasDub && { opacity: 0.45 }]}
                        disabled={!currentEpHasDub || isSwitchingAudio}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.settingsLabel, currentLang === 'dub' && { color: colors.accent }]}>
                            English (Dub)
                          </Text>
                          <Text style={styles.settingsSubLabel}>
                            {currentEpHasDub
                              ? 'English dubbed voice track'
                              : 'Japanese Audio (Sub) only for this episode'}
                          </Text>
                        </View>
                        {currentLang === 'dub' && <Icon name="check" size={20} color={colors.accent} />}
                        {!currentEpHasDub && (
                          <Text style={{ color: colors.muted, fontSize: 12 }}>Unavailable</Text>
                        )}
                      </PressableScale>
                    </>
                  )}
                </ScrollView>
              </>
            )}

            {/* Subtitles Sub-View */}
            {settingsSubView === 'subtitles' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Subtitles/CC</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  <PressableScale
                    onPress={() => {
                      handleToggleSubtitles(false);
                      setSettingsSubView('main');
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={[styles.settingsLabel, !subtitlesEnabled && { color: colors.accent }]}>Off</Text>
                    {!subtitlesEnabled && <Icon name="check" size={20} color={colors.accent} />}
                  </PressableScale>

                  {availableTextTracks.length > 0 ? (
                    availableTextTracks.map((track) => {
                      const isSel =
                        subtitlesEnabled &&
                        (nativeTextTrackId === track.id || (nativeTextTrackId === null && track.id === 0));
                      return (
                        <PressableScale
                          key={track.id}
                          onPress={() => {
                            setSubtitlesEnabled(true);
                            setNativeTextTrackId(track.id);
                            subtitlesEnabledRef.current = true;
                            showBadge(`Subtitles: ${track.name || track.lang}`);
                            setSettingsSubView('main');
                          }}
                          style={styles.settingsRow}
                        >
                          <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>
                            {track.name || track.lang}
                          </Text>
                          {isSel && <Icon name="check" size={20} color={colors.accent} />}
                        </PressableScale>
                      );
                    })
                  ) : (
                    <View style={{ padding: 16 }}>
                      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: 13 }}>
                        No soft subtitles in this stream (video is hardsubbed or multi-audio dubbed)
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </>
            )}

            {/* Quality Sub-View (Dynamically switches stream quality!) */}
            {settingsSubView === 'quality' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Quality</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Auto Option */}
                  <PressableScale
                    onPress={() => {
                      handleSelectQuality(-1);
                      setSettingsSubView('main');
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={[styles.settingsLabel, selectedQualityHeight === -1 && { color: colors.accent }]}>
                      Auto (Adaptive)
                    </Text>
                    {selectedQualityHeight === -1 && <Icon name="check" size={20} color={colors.accent} />}
                  </PressableScale>

                  {/* Available stream resolutions */}
                  {availableLevels.length > 0 ? (
                    availableLevels
                      .map((l) => l.height)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .sort((a, b) => b - a)
                      .map((h) => {
                        const isSel = selectedQualityHeight === h;
                        return (
                          <PressableScale
                            key={h}
                            onPress={() => {
                              handleSelectQuality(h);
                              setSettingsSubView('main');
                            }}
                            style={styles.settingsRow}
                          >
                            <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>{h}p</Text>
                            {isSel && <Icon name="check" size={20} color={colors.accent} />}
                          </PressableScale>
                        );
                      })
                  ) : (
                    <View style={{ padding: 16 }}>
                      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: 13 }}>
                        Detecting stream resolutions...
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </>
            )}

            {/* Speed Sub-View */}
            {settingsSubView === 'speed' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Playback Speed</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => {
                    const isSel = playbackSpeed === spd;
                    return (
                      <PressableScale
                        key={spd}
                        onPress={() => {
                          handleSetSpeed(spd);
                          setSettingsSubView('main');
                        }}
                        style={styles.settingsRow}
                      >
                        <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>
                          {spd === 1.0 ? '1.0x (Normal)' : `${spd.toFixed(2)}x`}
                        </Text>
                        {isSel && <Icon name="check" size={20} color={colors.accent} />}
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </View>
        )}
      </View>

      {/* Under-Player Content Area (Crunchyroll Layout in Portrait) */}
      {!isFullscreenView && (
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
                setSettingsSubView('audio');
                setSettingsOpen(true);
              }}
              style={styles.audioModesBadge}
            >
              <Text style={[styles.audioModesText, hasInBandAlternateAudio && { color: colors.accent }]}>
                {resolvingHls || !mountedStream
                  ? 'Loading Audio ▾'
                  : hasInBandAlternateAudio
                  ? `${availableAudioTracks.length} Audios ▾`
                  : currentEpHasDub
                  ? 'Dub | Sub ▾'
                  : 'Sub ▾'}
              </Text>
            </PressableScale>
          </View>

          {/* Quick Audio Language Selector */}
          {resolvingHls || !mountedStream ? (
            <View style={styles.quickAudioSection}>
              <View style={styles.quickAudioHeader}>
                <Icon name="mic" size={13} color={colors.accent} />
                <Text style={styles.quickAudioLabel}>AUDIO LANGUAGE</Text>
              </View>
              <View style={styles.quickAudioList}>
                <View style={[styles.quickAudioChip, { opacity: 0.6 }]}>
                  <Text style={styles.quickAudioChipText}>
                    {preferredAudioNameRef.current?.includes('hindi')
                      ? '🇮🇳 Hindi (Connecting...)'
                      : 'Detecting audio...'}
                  </Text>
                </View>
              </View>
            </View>
          ) : hasInBandAlternateAudio && availableAudioTracks.length > 0 ? (
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
                  const flag =
                    rawName.toLowerCase().includes('hindi') ? '🇮🇳 ' :
                    rawName.toLowerCase().includes('japan') ? '🇯🇵 ' :
                    rawName.toLowerCase().includes('english') ? '🇬🇧 ' :
                    rawName.toLowerCase().includes('telugu') ? '🇮🇳 ' :
                    rawName.toLowerCase().includes('tamil') ? '🇮🇳 ' : '';

                  return (
                    <PressableScale
                      key={track.id}
                      onPress={() => handleSelectAudio({ type: 'in-band', trackId: track.id })}
                      style={[styles.quickAudioChip, isSel && styles.quickAudioChipActive]}
                    >
                      <Text style={[styles.quickAudioChipText, isSel && styles.quickAudioChipTextActive]}>
                        {flag}{rawName}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : currentEpHasDub ? (
            <View style={styles.quickAudioSection}>
              <View style={styles.quickAudioHeader}>
                <Icon name="mic" size={13} color={colors.accent} />
                <Text style={styles.quickAudioLabel}>AUDIO LANGUAGE</Text>
              </View>
              <View style={styles.quickAudioList}>
                <PressableScale
                  onPress={() => currentLang !== 'sub' && handleSelectAudio({ type: 'separate', mode: 'sub' })}
                  style={[styles.quickAudioChip, currentLang === 'sub' && styles.quickAudioChipActive]}
                  disabled={isSwitchingAudio}
                >
                  <Text style={[styles.quickAudioChipText, currentLang === 'sub' && styles.quickAudioChipTextActive]}>
                    🇯🇵 Japanese (Sub)
                  </Text>
                </PressableScale>
                <PressableScale
                  onPress={() => currentLang !== 'dub' && handleSelectAudio({ type: 'separate', mode: 'dub' })}
                  style={[styles.quickAudioChip, currentLang === 'dub' && styles.quickAudioChipActive]}
                  disabled={isSwitchingAudio}
                >
                  <Text style={[styles.quickAudioChipText, currentLang === 'dub' && styles.quickAudioChipTextActive]}>
                    🇬🇧 English (Dub)
                  </Text>
                </PressableScale>
              </View>
            </View>
          ) : null}

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
                  setSettingsSubView('main');
                  setSettingsOpen(true);
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

              <PressableScale onPress={handleNextEpisode} style={styles.nextEpCard} scaleTo={0.98} haptic>
                <View style={styles.nextEpThumbWrap}>
                  <Image
                    source={{
                      uri: nextEpisodeObj.still_path || anime?.backdrop || anime?.banner || anime?.image || undefined,
                    }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.65)']} style={StyleSheet.absoluteFill} />
                  <View style={styles.nextEpPlayIcon}>
                    <Icon name="play" size={13} color="#fff" />
                  </View>
                  <View style={styles.nextEpDurationBadge}>
                    <Text style={styles.nextEpDurationText}>{nextEpisodeObj.runtime || 24}m</Text>
                  </View>
                </View>

                <View style={styles.nextEpInfo}>
                  <Text style={styles.nextEpNumLabel}>EPISODE {nextEpisodeObj.episode_number}</Text>
                  <Text style={styles.nextEpTitle} numberOfLines={2}>
                    {nextEpisodeObj.name || `Episode ${nextEpisodeObj.episode_number}`}
                  </Text>
                  <View style={styles.nextEpMetaRow}>
                    <EpisodeBadges hasSub={nextEpisodeObj.hasSub !== false} hasDub={nextEpisodeObj.hasDub !== false} />
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  containerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 9999,
  },
  playerContainer: {
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
  },
  playerContainerPortrait: {
    width: '100%',
  },
  playerContainerLandscape: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 9999,
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000000',
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